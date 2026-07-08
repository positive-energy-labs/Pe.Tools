import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
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
