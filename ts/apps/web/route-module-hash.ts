import { routeSourceHash } from "./route-source-hash.ts";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite-plus";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import ts from "typescript";
import { routeFingerprint } from "../../packages/agent-contracts/src/route-module.ts";
import type { RouteFingerprintInput } from "../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { RouteGraphJson } from "../../packages/agent-contracts/src/route-kernel-data.ts";
import { sharedContractId, type SharedRouteModule } from "./src/route/route-artifact.ts";

// TODO: S1c2 connect scripts/route-graphs.ts to this producer using the private legacy
// adapter's data, then replace the graph-only transform below with generated artifact loading.
/** Produce the exact self-contained JS closure the loader will evaluate. Source EOLs
 * normalize before compilation; the emitted bytes are hashed verbatim, never normalized.
 * No source-map is loaded. Unresolved imports and runtime-computed imports refuse. */
export async function buildRouteArtifact(options: {
  readonly entry: string;
  readonly root?: string;
  readonly data: RouteGraphJson;
  readonly contracts: readonly { readonly id: string; readonly bytes: Uint8Array }[];
  readonly shared?: readonly SharedRouteModule[];
}) {
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
const graphFile = /[\\/]src[\\/][^/\\]+[\\/]graph\.ts$/;
async function checkRoutes() {
  // A fresh process avoids retaining jiti's previously imported graph declarations during watch.
  await exec(process.execPath, [
    fileURLToPath(new URL("./scripts/route-graphs.ts", import.meta.url)),
    "--check",
  ]);
  await exec(process.execPath, [
    fileURLToPath(
      new URL("../../packages/agent-contracts/scripts/route-links-cs.ts", import.meta.url),
    ),
    "--check",
  ]);
}

/** Bundling and tests only check projections; explicit codegen owns tracked-file writes. */
export function routeModuleHash(check = checkRoutes): Plugin {
  let pending: Promise<void> = Promise.resolve();
  const refresh = () => (pending = pending.then(check, check));
  return {
    name: "route-module-hash",
    enforce: "pre",
    async buildStart() {
      await refresh();
    },
    async handleHotUpdate({ file, server }) {
      if (!graphFile.test(file)) return;
      await refresh();
      // Graphs register at module scope. Replace graph + directory together, never HMR one half.
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
      return [];
    },
    async transform(code, id) {
      // A request arriving during verification must not see a new graph with the old directory.
      await pending;
      if (!graphFile.test(id)) return;
      const hash = routeSourceHash(readFileSync(id));
      return {
        code: code.replace(/\bdirectory\s*:/g, `moduleHash: "${hash}", directory:`),
        map: null,
      };
    },
  };
}
