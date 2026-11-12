import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface RouteStartupProjection {
  readonly checkout: string;
  readonly sourceHash: string;
  readonly projections: Record<string, string>;
}

/** The one on-disk receipt (ignored build output) of the last full producer run. */
export const routeStartupReceiptPath = (root: string) =>
  resolve(root, "ts/apps/web/node_modules/.cache/route-projection.json");

export const routeStartupOwner = (root: string) => realpathSync(root).toLowerCase();

/** Include discovery/config inputs and new files, not just the previous import closure. */
export function routeStartupSourceHash(root: string) {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "ts", "examples"], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    .toString().split("\0").filter(Boolean).sort();
  if (!files.length) throw Error("Route startup requires checkout sources");
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0");
    try { hash.update(readFileSync(resolve(root, file))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("<deleted>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Check resolved dependency bytes too, including ignored node_modules and fixture inputs. */
export function currentRouteStartupProjection(root: string, receipt: RouteStartupProjection) {
  try {
    if (receipt.checkout !== routeStartupOwner(root) || receipt.sourceHash !== routeStartupSourceHash(root)) return false;
    const closures = Object.entries(receipt.projections).filter(([id]) => id.endsWith("/source-closure.generated.json") || id.endsWith("\\source-closure.generated.json"));
    if (!closures.length) return false;
    const checked = new Map<string, string>();
    for (const [id, text] of Object.entries(receipt.projections)) {
      const path = relative(root, id);
      if (!isAbsolute(id) || path.startsWith("..") || isAbsolute(path) || typeof text !== "string") return false;
    }
    for (const [, text] of closures) {
      const { envelope } = JSON.parse(text);
      for (const member of [...envelope.modules, ...envelope.inputs]) {
        if (member.id.startsWith("virtual:") || member.id.startsWith("build:")) continue;
        const path = resolve(root, member.id);
        const rel = relative(root, path);
        if (rel.startsWith("..") || isAbsolute(rel)) return false;
        let actual = checked.get(path);
        if (!actual) {
          const bytes = readFileSync(path);
          actual = createHash("sha256").update(/\.(?:[cm]?[jt]sx?|json|css|html|svg|txt|yaml|yml|toml|md|map)$/.test(path) ? bytes.toString("utf8").replaceAll("\r\n", "\n") : bytes).digest("hex");
          checked.set(path, actual);
        }
        if (actual !== member.sha256) return false;
      }
    }
    return true;
  } catch {
    // A missing, malformed or racing handoff is a cache miss; the producer remains authority.
    return false;
  }
}

/** The freshness check hashes what git lists, and the producer finds routes by reading the folder. A route
 * folder git ignores is therefore invisible to the check, so the receipt is off while one exists.
 * `git check-ignore` exits 1 when none of the paths is ignored. */
const noIgnoredRouteFolder = (root: string) => {
  const source = resolve(root, "ts/apps/web/src");
  return spawnSync("git", ["check-ignore", ...readdirSync(source, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(source, d.name, "route.ts")))
    .map((d) => join(source, d.name))], { cwd: source }).status === 1;
};

/** The stored receipt while it is still current, else undefined: the producer remains authority. */
export function readRouteStartupReceipt(root: string): RouteStartupProjection | undefined {
  try {
    if (!noIgnoredRouteFolder(root)) return undefined;
    const receipt = JSON.parse(readFileSync(routeStartupReceiptPath(root), "utf8")) as RouteStartupProjection;
    return currentRouteStartupProjection(root, receipt) ? receipt : undefined;
  } catch {
    return undefined;
  }
}

/** `sourceHash` is the hash taken BEFORE producing: an edit during the run, or a producer run that
 * rewrote tracked output, leaves no receipt rather than one the sources never matched. */
export function writeRouteStartupReceipt(root: string, sourceHash: string, projections: Record<string, string>) {
  if (!noIgnoredRouteFolder(root) || routeStartupSourceHash(root) !== sourceHash) return;
  const path = routeStartupReceiptPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}`;
  writeFileSync(temp, JSON.stringify({ checkout: routeStartupOwner(root), sourceHash, projections } satisfies RouteStartupProjection));
  try {
    renameSync(temp, path);
  } catch {
    // Windows refuses a rename over a file another run has open. That run holds an equally fresh receipt.
    rmSync(temp, { force: true });
  }
}
