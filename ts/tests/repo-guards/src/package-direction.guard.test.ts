import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ROOT, imports } from "./import-census.ts";
import baseline from "./reach-through.baseline.json" with { type: "json" };

const REPO = join(ROOT, "..");
const BASELINE = "ts/tests/repo-guards/src/reach-through.baseline.json";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
// Untracked-unignored files count too, so a new file is seen before it is staged.
const sources = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
  .split("\0")
  .filter((file) => /\.(?:tsx?|mts|cts)$/.test(file) && existsSync(join(REPO, file)));
const read = (file: string) => imports(readFileSync(join(REPO, file), "utf8"), file, true);
const under = (dir: string) =>
  sources.filter((file) => file.startsWith(dir) && /\.tsx?$/.test(file));

// Sites, partition and owners of .artifacts/runs/analysis-20261104/comparison/imports-frozen.mjs over
// measure.py's manifest, so the counts are the research thread's (355 at 5ad5625f and c75ffe79).
const SKIP =
  /(?:^|\/)(?:generated|vendor|dist|dist-installed|bin|obj|node_modules|\.artifacts)\/|\.generated\.|routeTree\.gen\.ts$|test|typecheck|fixture|prototype|\/examples\//i;
function reachThrough(): Record<string, number> {
  const names = new Map(
    git("ls-files", "ts/**/package.json")
      .trim()
      .split("\n")
      .sort((a, b) => b.length - a.length)
      .map((file) => [
        posix.dirname(file) + "/",
        JSON.parse(readFileSync(join(REPO, file), "utf8")).name,
      ]),
  );
  const owner = (path: string) =>
    [...names].find(([root]) => path.startsWith(root))?.[1] ?? "other";
  const counts: Record<string, number> = {};
  for (const file of sources.filter((file) => !SKIP.test(file)))
    for (const { module } of read(file)) {
      const [from, to] = [owner(file), owner(posix.join(posix.dirname(file), module))];
      const pair = `${from} -> ${to}`;
      if (module.startsWith(".") && from !== to) counts[pair] = (counts[pair] ?? 0) + 1;
    }
  return counts;
}

describe("contracts <- runtime <- surface adapters", () => {
  it("keeps lower packages independent of MCP and app adapters", () => {
    const violations: string[] = [];
    for (const name of ["host-contracts", "agent-contracts", "runtime", "kit"]) {
      const directory = join(ROOT, "packages", name);
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const forbidden = (specifier: string) =>
        /^@pe\/(?:mcps|host|web)(?:\/|$)/.test(specifier) ||
        /(?:^|\/)apps\/(?:host|web)(?:\/|$)/.test(specifier) ||
        /(?:^|\/)mcps(?:\/|$)/.test(specifier) ||
        (name === "kit" && /^#\/(?:host|route|scene)(?:\/|$)/.test(specifier)) ||
        (name !== "runtime" &&
          name !== "kit" &&
          (/^@pe\/runtime(?:\/|$)/.test(specifier) || /(?:^|\/)runtime(?:\/|$)/.test(specifier)));
      for (const dependency of Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      })) {
        if (forbidden(dependency)) violations.push(`${name}: dependency ${dependency}`);
      }
      for (const path of under(`ts/packages/${name}/src/`)) {
        for (const { module } of read(path)) {
          if (forbidden(module)) violations.push(`${path}: ${module}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("makes the host obtain invocation scope and runtime capabilities below MCP", () => {
    const violations: string[] = [];
    for (const path of under("ts/apps/host/src/")) {
      for (const { module, names } of read(path)) {
        const mcp = /^@pe\/mcps(?:\/|$)/.test(module) || module.includes("packages/mcps/");
        if (
          mcp &&
          (/invocation-context|\/context$/.test(module) ||
            /\b(?:PeaRuntimeCapabilities|InvocationContext|RequestPrincipal)\b/.test(String(names)))
        )
          violations.push(`${path}: ${module}`);
      }
    }
    expect(violations).toEqual([]);
  });

  // Trust every committed version of the baseline reachable from HEAD: never a ref the file names,
  // never merge-base HEAD main (on main that is HEAD, so a committed raise would ratify itself).
  // A raise committed once stays red. Re-baselining means a new file path, visible in review.
  it("never grows cross-package relative reach-through, and its baseline only shrinks", () => {
    const exceeds = (counts: Record<string, number>, cap: Record<string, number>, of: string) =>
      Object.entries(counts)
        .filter(([pair, count]) => count > (cap[pair] ?? 0))
        .map(([pair, count]) => `${pair}: ${count} > ${cap[pair] ?? 0} in ${of}`);
    const versions = git("log", "--format=%H", "HEAD", "--", BASELINE).split("\n").filter(Boolean);
    expect([
      ...exceeds(reachThrough(), baseline, "baseline"),
      ...versions.flatMap((commit) =>
        exceeds(baseline, JSON.parse(git("show", `${commit}:${BASELINE}`)), commit),
      ),
    ]).toEqual([]);
  }, 60_000);
});
