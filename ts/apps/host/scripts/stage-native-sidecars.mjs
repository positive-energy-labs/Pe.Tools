import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const payloadRoot = join(here, "..", "dist-installed");
const workspaceRoot = join(here, "..", "..", "..");
const pnpmStore = join(workspaceRoot, "node_modules", ".pnpm");

const packages = [
  // get-stream v9 (SEA require shim target — rolldown mis-renames its `nodeImports` binding when
  // inlined) plus its two runtime deps, which it imports from the staged node_modules. Prefixes
  // are version-pinned: the store also holds get-stream@5 / is-stream@2 for other consumers.
  {
    name: "get-stream",
    storePrefix: "get-stream@9.",
  },
  {
    name: "@sec-ant/readable-stream",
    storePrefix: "@sec-ant+readable-stream@",
  },
  {
    name: "is-stream",
    storePrefix: "is-stream@4.",
  },
];

for (const { name, storePrefix } of packages) {
  const storeEntry = readdirSync(pnpmStore).find((entry) => entry.startsWith(storePrefix));
  if (!storeEntry) {
    console.error(`native sidecar package not found in ${pnpmStore}: ${name}`);
    process.exit(1);
  }

  const source = join(pnpmStore, storeEntry, "node_modules", ...name.split("/"));
  const destination = join(payloadRoot, "node_modules", ...name.split("/"));

  if (!existsSync(source)) {
    console.error(`native sidecar not found: ${name}`);
    process.exit(1);
  }

  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  console.log(`staged native sidecar ${name} -> ${destination}`);
}
