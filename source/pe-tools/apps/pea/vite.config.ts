import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

/**
 * SEA-safe sidecar shim for drizzle-orm (D8).
 *
 * Drizzle must NOT be inlined: the SEA bundle's module ordering breaks its circular imports
 * (`TypedQueryBuilder` ReferenceError at Mastra init). Plain `deps.neverBundle` is not enough
 * either: a static ESM `import` of an external bare specifier dies inside the Node SEA
 * (`ERR_UNKNOWN_BUILTIN_MODULE` — the embedded ESM entry can only static-import builtins).
 *
 * The native sidecars already prove the one mechanism that works: a runtime
 * `createRequire(import.meta.url)` call, which inside the SEA resolves against `node_modules`
 * beside pea.exe (where stage-native-sidecars.mjs stages the package). So every matched
 * import is rewritten to a tiny bundled ESM shim that requires the real package at runtime.
 * Named exports are enumerated at build time from the store copy so the bundler can bind
 * consumers' named imports statically.
 *
 * Copied verbatim from apps/host/vite.config.ts: pea boots the SAME Mastra runtime
 * (createPeaRuntime -> `await import("mastracode")` -> the same drizzle/onnx/get-stream chain),
 * so it needs the SAME SEA treatment (docs/rework/SDK-LEDGER.md T5).
 *
 * Shimmed packages (store prefixes are version-pinned when the store holds several versions):
 * - drizzle-orm: inlining breaks its circular imports (TypedQueryBuilder ReferenceError).
 * - get-stream (v9, ESM-only — Node 25 require(esm) handles it): rolldown duplicates the module
 *   and mis-renames its export-then-mutate `nodeImports` binding (declared `nodeImports$1`,
 *   mutated as undeclared `nodeImports`) — same inlining bug class, surfaced at Mastra init.
 */
const seaRequireSpecifiers = /^(?:drizzle-orm(?:\/|$)|get-stream$)/;
const seaRequirePackages: Record<string, string> = {
  "drizzle-orm": "drizzle-orm@",
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
    (name) => name !== "default" && name !== "__esModule" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
  );
  return [
    `import { createRequire } from "node:module";`,
    `const m = createRequire(import.meta.url)(${JSON.stringify(spec)});`,
    isNamespace && "default" in exportsObject ? `export default m.default;` : `export default m;`,
    ...names.map((name) => `export const ${name} = m.${name};`),
    "",
  ].join("\n");
}

/**
 * Throwing stub for onnxruntime-node (T9 decision record, docs/rework/SDK-LEDGER.md).
 *
 * mastracode eagerly imports @mastra/fastembed (chunk-YADYGJS7.js:32) whose
 * `import * as ort from "onnxruntime-node"` drags a 255MB native package into every init — but
 * NO embedding-dependent memory feature is exercised by pea (no embedder configured,
 * semanticRecall off, OM is LLM-based). All `ort.*` usage sits inside async embed methods, never
 * at module eval, so a stub that loads cleanly and throws only on USE is init-safe. Export names
 * are enumerated at build time from onnxruntime-common (pure JS; onnxruntime-node's index
 * re-exports it) so namespace consumers bind normally.
 */
const seaStubSpecifiers = /^onnxruntime-node$/;
const seaStubVirtualPrefix = "\0pe-sea-stub:";
const seaStubMessage =
  "onnxruntime-node is stubbed in the installed pea (no embedder configured); " +
  "if embeddings are enabled, un-stub it — see docs/rework/SDK-LEDGER.md T9";

function seaStubShimSource(): string {
  const storeEntry = readdirSync(pnpmStore).find((entry) =>
    entry.startsWith("onnxruntime-common@"),
  );
  if (!storeEntry) throw new Error(`onnxruntime-common not found in ${pnpmStore}`);
  const commonRequire = createRequire(
    join(pnpmStore, storeEntry, "node_modules", "onnxruntime-common", "package.json"),
  );
  const names = new Set(Object.keys(commonRequire("onnxruntime-common") as object));
  for (const extra of ["listSupportedBackends", "binding", "initOrt"]) names.add(extra);
  const exportNames = [...names].filter(
    (name) => name !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
  );
  return [
    `const message = ${JSON.stringify(seaStubMessage)};`,
    `const stub = new Proxy(function () {}, {`,
    `  get(_target, prop) {`,
    `    if (typeof prop !== "string" || prop === "__esModule" || prop === "then") return undefined;`,
    `    throw new Error(message);`,
    `  },`,
    `  apply() { throw new Error(message); },`,
    `  construct() { throw new Error(message); },`,
    `});`,
    `export default stub;`,
    ...exportNames.map((name) => `export const ${name} = stub;`),
    "",
  ].join("\n");
}

const seaRequireShim = {
  name: "pe:sea-require-shim",
  resolveId: {
    order: "pre" as const,
    handler(source: string) {
      if (seaStubSpecifiers.test(source)) return seaStubVirtualPrefix + source;
      return seaRequireSpecifiers.test(source) ? seaRequireVirtualPrefix + source : null;
    },
  },
  load(id: string) {
    if (id.startsWith(seaStubVirtualPrefix)) return seaStubShimSource();
    return id.startsWith(seaRequireVirtualPrefix)
      ? seaRequireShimSource(id.slice(seaRequireVirtualPrefix.length))
      : null;
  },
};

export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    plugins: [seaRequireShim],
    deps: {
      alwaysBundle: [/./],
      neverBundle: [
        /^@duckdb\/node-bindings-win32-x64/,
        /^@anush008\/tokenizers-win32-x64-msvc/,
        /^@libsql\/win32-x64-msvc/,
      ],
      onlyBundle: false,
    },
    loader: {
      ".wasm": "base64",
      ".scm": "text",
    },
    exe: {
      fileName: "pea",
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
});
