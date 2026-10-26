import { existsSync, readFileSync, readdirSync } from "node:fs";

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
