import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const readManifest = (root: URL): Manifest =>
  JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const runtimeDependencies = (manifest: Manifest) =>
  Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });

/** One watcher remembers the workspace lock accepted by its last successful frozen install. */
export function createDevDependencyRepair(
  workspace: URL,
  execute: (command: string, args: string[], options: { cwd: URL }) => Promise<unknown> = run,
) {
  const installed = new URL("node_modules/.pnpm/lock.yaml", workspace);
  const wanted = new URL("pnpm-lock.yaml", workspace);
  let repairedHash: string | undefined;
  return async () => {
    const lock = readFileSync(wanted);
    const hash = createHash("sha256").update(lock).digest("hex");
    if (hash === repairedHash) return;
    repairedHash = undefined;
    if (existsSync(installed) && readFileSync(installed).equals(lock)) return;

    const args = ["i", "--frozen-lockfile", "--prefer-offline"];
    const command = `vp ${args.join(" ")}`;
    console.log(`Dev server dependencies are out of date. Running \`${command}\` from ts.`);
    try {
      await execute("vp", args, { cwd: workspace });
    } catch (error) {
      const recovery = `Dev server dependencies are out of date. Run \`${command}\` from ts, then start the dev server again.`;
      throw new Error(`${recovery}\n${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    // A successful no-op install may leave the virtual store's lock bytes untouched.
    repairedHash = hash;
  };
}

/** Vite owns frontend HMR. A package edit restarts the host only if its runtime graph uses it;
 * kit page assets are read on request, so serving them is not a host-code dependency. */
export function devWatchRoots(hostRoot: URL): URL[] {
  const packages = new URL("../../packages/", hostRoot);
  const workspace = new Map<string, { root: URL; manifest: Manifest }>();
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = new URL(`${entry.name}/`, packages);
    if (!existsSync(new URL("package.json", root))) continue;
    const manifest = readManifest(root);
    workspace.set(manifest.name, { root, manifest });
  }
  const roots = [new URL("src/", hostRoot)];
  const seen = new Set<string>();
  const pending = runtimeDependencies(readManifest(hostRoot));
  for (const name of pending) {
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = workspace.get(name);
    if (!pkg) continue;
    const src = new URL("src/", pkg.root);
    if (existsSync(src)) roots.push(src);
    pending.push(...runtimeDependencies(pkg.manifest));
  }
  return roots;
}
