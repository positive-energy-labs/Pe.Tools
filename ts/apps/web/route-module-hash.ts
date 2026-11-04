import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite-plus";
import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import ts from "typescript";
import { routeFingerprint } from "../../packages/agent-contracts/src/route-module.ts";
import type { RouteFingerprintInput } from "../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { RouteGraphJson } from "../../packages/agent-contracts/src/route-kernel-data.ts";
import { sharedContractId, type SharedRouteModule } from "./src/route/route-artifact.ts";

/** Pod packaging only. Builtins use buildBuiltinClosure, with ordinary source imports.
 * Produce the exact self-contained JS closure the package loader will evaluate. Source EOLs
 * normalize before compilation; the emitted bytes are hashed verbatim, never normalized.
 * No source-map is loaded. Unresolved imports and runtime-computed imports refuse. */
export async function buildRouteArtifact(options: {
  readonly entry: string;
  readonly root?: string;
  readonly data: RouteGraphJson;
  readonly contracts: readonly { readonly id: string; readonly bytes: Uint8Array }[];
  readonly shared?: readonly SharedRouteModule[];
}) {
  if (!isAbsolute(options.entry) || (options.root !== undefined && !isAbsolute(options.root)))
    throw Error("Pod artifact entry and root must be absolute");
  const shared = (options.shared ?? [])
    .map((item) => ({
      ...item,
      bytes: new Uint8Array(item.bytes),
    }))
    .sort((a, b) => (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0));
  if (new Set(shared.map((item) => item.specifier)).size !== shared.length)
    throw Error("Duplicate shared route module");
  for (const item of shared) sharedContractId(item);
  const data = structuredClone(options.data);
  const contracts = [
    ...options.contracts,
    ...shared.map((item) => ({
      id: sharedContractId(item),
      bytes: item.bytes,
    })),
  ].map(({ id, bytes }) => ({
    id,
    bytes: new Uint8Array(bytes),
  }));
  const output = await build({
    configFile: false,
    root: options.root ?? dirname(options.entry),
    logLevel: "silent",
    plugins: [
      {
        name: "route-artifact-source-eol",
        enforce: "pre",
        resolveId(id) {
          // Never silently bundle a second copy of a stateful shell runtime. Subpath
          // imports need their own explicit deployment pin, not the parent package's bytes.
          if (
            ["react", "react-dom", "effect", "@effect/atom-react", "@pe/runtime", "@pe/kit"].some(
              (name) => id === name || id.startsWith(`${name}/`),
            ) &&
            !shared.some((item) => item.specifier === id)
          )
            throw Error(`Shared route module needs an explicit deployment pin: ${id}`);
        },
        load(id) {
          if (/\.[cm]?[jt]sx?$/.test(id)) return readFileSync(id, "utf8").replaceAll("\r\n", "\n");
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: "esnext",
      sourcemap: false,
      lib: {
        entry: options.entry,
        formats: [shared.length ? "iife" : "es"],
        name: "__routeArtifact",
        fileName: () => "route.js",
      },
      rolldownOptions: {
        external: shared.map((item) => item.specifier),
        output: {
          codeSplitting: false,
          globals: Object.fromEntries(
            shared.map((item, i) => [item.specifier, `__routeShared${i}`]),
          ),
        },
      },
    },
  });
  const bundles = Array.isArray(output) ? output : [output];
  const members: { path: string; bytes: Uint8Array }[] = [];
  for (const bundle of bundles) {
    if (!("output" in bundle)) throw Error("Route artifacts cannot use a watch build");
    for (const file of bundle.output) {
      if (file.type === "chunk") {
        if (
          file.imports.some((id) => !shared.some((item) => item.specifier === id)) ||
          file.dynamicImports.length
        )
          throw Error(`Unresolved executable dependency closure: ${file.fileName}`);
        const source = ts.createSourceFile(file.fileName, file.code, ts.ScriptTarget.Latest, true);
        const inspect = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
            throw Error(`Runtime import is not part of the closed artifact: ${file.fileName}`);
          ts.forEachChild(node, inspect);
        };
        inspect(source);
      }
      const content =
        file.type === "chunk"
          ? shared.length
            ? `export function instantiate(shared) {\n${shared.map((item, i) => `const __routeShared${i} = shared[${JSON.stringify(item.specifier)}];`).join("\n")}\n${file.code}\nreturn __routeArtifact;\n}\n`
            : file.code
          : file.source;
      members.push({
        path: file.fileName,
        bytes:
          typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content),
      });
    }
  }
  members.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const artifact: RouteFingerprintInput = {
    version: 1,
    data,
    contracts: contracts.map(({ id, bytes }) => ({ id, sha256: sha256(bytes) })),
    executables: [
      {
        client: "web",
        entry: "route.js",
        members: members.map(({ path, bytes }) => ({ path, sha256: sha256(bytes) })),
      },
    ],
  };
  return {
    artifact,
    fingerprint: await routeFingerprint(artifact),
    contracts,
    executables: [{ client: "web" as const, entry: "route.js", resolved: true, members }],
  };
}

const exec = promisify(execFile);
async function runtimeRoutes(mode: "dev" | "build" | "test") {
  const producer = fileURLToPath(new URL("./scripts/route-graphs.ts", import.meta.url));
  if (mode === "build")
    await exec(process.execPath, [producer, "--builtin-closure-only", "--check"]);
  // Dev repairs committed pins before publishing a coordinated generation. Build only checks.
  const { stdout } = await exec(
    process.execPath,
    [producer, "--runtime", ...(mode === "dev" ? ["--write-builtin-closures"] : [])],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Record<string, string>;
}

/** Dev regenerates pins before startup/HMR; production refuses a stale build pin. */
export function routeModuleHash(
  generate?: (mode: "dev" | "build" | "test") => Promise<Record<string, string> | void>,
): Plugin {
  let mode: "dev" | "build" | "test" = "test";
  let projections: Record<string, string> = {};
  let pending: Promise<void> = Promise.resolve();
  const update = async () => {
    projections = (await (generate ? generate(mode) : runtimeRoutes(mode))) ?? {};
  };
  const refresh = () => (pending = pending.then(update, update));
  const watchFiles = () =>
    Object.entries(projections)
      .filter(([id]) => id.endsWith("source-closure.generated.json"))
      .flatMap(([, text]) => {
        const closure = JSON.parse(text);
        return [...closure.envelope.modules, ...closure.envelope.inputs]
          .filter(
            (item: { id: string }) =>
              !item.id.startsWith("virtual:") && !item.id.startsWith("build:"),
          )
          .map((item: { id: string }) =>
            fileURLToPath(new URL(item.id, new URL("../../../", import.meta.url))),
          );
      });
  return {
    name: "route-module-hash",
    enforce: "pre",
    configResolved(config) {
      mode = config.command === "build" ? "build" : config.mode === "test" ? "test" : "dev";
    },
    async buildStart() {
      await refresh();
      // Watch current resolved inputs, even when the committed inventory is stale or missing.
      for (const file of watchFiles()) this.addWatchFile(file);
    },
    async load(id) {
      await pending;
      const filename = id.split("?")[0]!;
      return projections[filename] ?? projections[filename.replaceAll("/", "\\")];
    },
    async handleHotUpdate({ server }) {
      // The closure includes schemas, codecs, assets and build inputs outside graph.ts.
      // Recompute on every watched source edit; invalid declarations block reload.
      await refresh();
      for (const file of watchFiles()) server.watcher?.add(file);
      // Graphs register at module scope. Replace graph + directory together, never HMR one half.
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
      return [];
    },
    // Legacy admission is enumerated in legacy-route-door; this plugin mints no admission.
    async transform() {
      // A request arriving during verification must not see a new graph with the old directory.
      await pending;
    },
  };
}
