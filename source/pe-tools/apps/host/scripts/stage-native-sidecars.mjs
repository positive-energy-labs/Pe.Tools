import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const payloadRoot = join(here, "..", "dist-installed");
const workspaceRoot = join(here, "..", "..", "..");
const pnpmStore = join(workspaceRoot, "node_modules", ".pnpm");

const packages = [
  {
    name: "@duckdb/node-bindings-win32-x64",
    storePrefix: "@duckdb+node-bindings-win32-x64@",
  },
  {
    name: "@anush008/tokenizers-win32-x64-msvc",
    storePrefix: "@anush008+tokenizers-win32-x64-msvc@",
  },
  {
    name: "@libsql/win32-x64-msvc",
    storePrefix: "@libsql+win32-x64-msvc@",
  },
  // JS sidecar, not a native binding: drizzle-orm is kept out of the bundle by the SEA require
  // shim in vite.config.ts because inlining it breaks its circular imports in the SEA bundle
  // (TypedQueryBuilder ReferenceError at Mastra init). The shim requires it at runtime from this
  // staged copy. drizzle-orm@0.45.2 has zero runtime dependencies, so the package dir is complete.
  {
    name: "drizzle-orm",
    storePrefix: "drizzle-orm@",
  },
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

// mastracode self-locates its package root at module init: it walks UP from
// dirname(import.meta.url) — the exe's directory in the SEA — until it finds a package.json whose
// name is "mastracode", and THROWS if none exists (findMastraCodePackageRoot; the root is only
// ever used by its local-plugin symlink machinery, which this host never exercises). This decoy
// terminates that walk at the payload root. Upstream ask (MASTRA_UPSTREAM_CANDIDATES.md): make
// MASTRACODE_PACKAGE_ROOT lazy so bundled consumers don't need this.
writeFileSync(
  join(payloadRoot, "package.json"),
  `${JSON.stringify({ name: "mastracode", version: "0.30.0", private: true }, null, 2)}\n`,
);
console.log(`staged mastracode package-root decoy -> ${join(payloadRoot, "package.json")}`);
