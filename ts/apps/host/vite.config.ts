import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

/**
 * SEA-safe sidecar shim for get-stream.
 *
 * A static ESM `import` of an external bare specifier dies inside the Node SEA
 * (`ERR_UNKNOWN_BUILTIN_MODULE` — the embedded ESM entry can only static-import builtins).
 *
 * The native sidecars already prove the one mechanism that works: a runtime
 * `createRequire(import.meta.url)` call, which inside the SEA resolves against `node_modules`
 * beside Pe.Host.exe (where stage-native-sidecars.mjs stages the package). So every matched
 * import is rewritten to a tiny bundled ESM shim that requires the real package at runtime.
 * Named exports are enumerated at build time from the store copy so the bundler can bind
 * consumers' named imports statically.
 *
 * Shimmed packages (store prefixes are version-pinned when the store holds several versions):
 * - get-stream (v9, ESM-only — Node 25 require(esm) handles it): rolldown duplicates the module
 *   and mis-renames its export-then-mutate `nodeImports` binding (declared `nodeImports$1`,
 *   mutated as undeclared `nodeImports`). It arrives through @mastra/core (execa), which the
 *   Pea MCP tools still import.
 */
const seaRequireSpecifiers = /^get-stream$/;
const seaRequirePackages: Record<string, string> = {
  "get-stream": "get-stream@9.",
};
const seaRequireVirtualPrefix = "\0pe-sea-require:";

const here = dirname(fileURLToPath(import.meta.url));
const pnpmStore = join(here, "..", "..", "node_modules", ".pnpm");

function seaRequireBuildTimeRequire(spec: string): NodeJS.Require {
  const name = spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : (spec.split("/")[0] as string);
  const storePrefix = seaRequirePackages[name];
  if (!storePrefix) throw new Error(`no store prefix registered for shimmed package ${name}`);
  const storeEntry = readdirSync(pnpmStore).find((entry) => entry.startsWith(storePrefix));
  if (!storeEntry) throw new Error(`${name} not found in ${pnpmStore}`);
  return createRequire(
    join(pnpmStore, storeEntry, "node_modules", ...name.split("/"), "package.json"),
  );
}

function seaRequireShimSource(spec: string): string {
  // Load the real module in the build process (self-reference resolution from the package's own
  // package.json) purely to enumerate its export names. require(esm) yields a module namespace;
  // unwrap its `default` so `import x from "spec"` binds the real default export, not the
  // namespace (runtime require has identical semantics, so the build-time probe is authoritative).
  const exportsObject = seaRequireBuildTimeRequire(spec)(spec) as Record<string | symbol, unknown>;
  const isNamespace =
    typeof exportsObject === "object" &&
    exportsObject !== null &&
    exportsObject[Symbol.toStringTag] === "Module";
  const names = Object.keys(exportsObject).filter(
    (name) =>
      name !== "default" && name !== "__esModule" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
  );
  return [
    `import { createRequire } from "node:module";`,
    `const m = createRequire(import.meta.url)(${JSON.stringify(spec)});`,
    isNamespace && "default" in exportsObject ? `export default m.default;` : `export default m;`,
    ...names.map((name) => `export const ${name} = m.${name};`),
    "",
  ].join("\n");
}

const seaRequireShim = {
  name: "pe:sea-require-shim",
  resolveId: {
    order: "pre" as const,
    handler(source: string) {
      return seaRequireSpecifiers.test(source) ? seaRequireVirtualPrefix + source : null;
    },
  },
  load(id: string) {
    return id.startsWith(seaRequireVirtualPrefix)
      ? seaRequireShimSource(id.slice(seaRequireVirtualPrefix.length))
      : null;
  },
};

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    plugins: [seaRequireShim],
    deps: {
      alwaysBundle: [/./],
      onlyBundle: false,
    },
    loader: {
      ".wasm": "base64",
      ".scm": "text",
    },
    exe: {
      fileName: "Pe.Host",
      outDir: "dist-installed",
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  // Unit tests import the host module graph directly (not via the source entry points), so
  // ensure-source-lane.ts does not run — declare the dev lane here so resolveHostLane's PE_LANE
  // fail-fast (IPC-SEAM-SPEC D7) sees a valid signal instead of throwing at module load.
  // Host boundary scenarios claim the same source service identity; parallel files would make
  // one test take over another test's server instead of testing either lifecycle.
  test: { env: { PE_LANE: "dev" }, fileParallelism: false },
});
