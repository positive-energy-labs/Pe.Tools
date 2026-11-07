import { currentRouteStartupProjection } from "@pe/host-contracts/route-startup";
import type { RouteStartupProjection } from "@pe/host-contracts/route-startup";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "vite-plus";
import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import ts from "typescript";
import { routeFingerprint } from "../../packages/agent-contracts/src/route-module.ts";
import type { RouteFingerprintInput } from "../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { RouteGraphJson } from "../../packages/agent-contracts/src/route-kernel-data.ts";
import { sharedContractId, type SharedRouteModule, type RouteArtifactBytes } from "./src/route/route-artifact.ts";

/** Pod packaging only. Builtins use buildBuiltinClosure, with ordinary source imports.
 * Produce the exact self-contained JS closure the package loader will evaluate. Source EOLs
 * normalize before compilation; the emitted bytes are hashed verbatim, never normalized.
 * No source-map is loaded. Unresolved imports and runtime-computed imports refuse. */
export async function buildRouteArtifact(options: {
  readonly entry: string;
  readonly source?: string;
  readonly hostEntry?: {readonly entry:string;readonly source:string};
  readonly root?: string;
  readonly data: RouteGraphJson;
  readonly contracts: readonly { readonly id: string; readonly bytes: Uint8Array }[];
  readonly shared?: readonly SharedRouteModule[];
}):Promise<RouteArtifactBytes> {
  if(options.hostEntry) {
    const {hostEntry,...browser}=options;
    const [web,host]=await Promise.all([buildRouteArtifact(browser),buildRouteArtifact({...browser,...hostEntry,shared:[]})]);
    const hostExecutable={...host.executables[0]!,client:"host" as const,entry:"host.js",
      members:host.executables[0]!.members.map(member=>({...member,path:member.path==="route.js"?"host.js":member.path}))};
    const artifact={...web.artifact,executables:[...web.artifact.executables,{client:"host" as const,entry:"host.js",
      members:hostExecutable.members.map(member=>({path:member.path,sha256:createHash("sha256").update(member.bytes).digest("hex")}))}]};
    return {...web,artifact,fingerprint:await routeFingerprint(artifact),executables:[...web.executables,hostExecutable]};
  }
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
        resolveId(id, importer) {
          if(options.source !== undefined && id === options.entry) return id;
          // Never silently bundle a second copy of a stateful shell runtime. Subpath
          // imports need their own explicit deployment pin, not the parent package's bytes.
          if (
            ["react", "react-dom", "effect", "@effect/atom-react", "@pe/runtime", "@pe/kit"].some(
              (name) => id === name || id.startsWith(`${name}/`),
            ) &&
            !shared.some((item) => item.specifier === id)
          )
            throw Error(`Shared route module needs an explicit deployment pin: ${id} (imported by ${importer})`);
        },
        load(id) {
          if(options.source !== undefined && id === options.entry) return options.source;
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
async function runtimeRoutes() {
  const handoff = process.env.PE_DEV_ROUTE_PROJECTION;
  // One launch handoff only: edits and subsequent builds always return to the producer.
  delete process.env.PE_DEV_ROUTE_PROJECTION;
  if (handoff) {
    try {
      const receipt = JSON.parse(readFileSync(handoff, "utf8")) as RouteStartupProjection;
      const root = fileURLToPath(new URL("../../../", import.meta.url));
      if (currentRouteStartupProjection(root, receipt)) return receipt.projections;
    } catch {
      // Unavailable or malformed handoff: recompute rather than serving stale projections.
    }
  }
  const producer = fileURLToPath(new URL("./scripts/route-graphs.ts", import.meta.url));
  const { stdout } = await exec(process.execPath, [producer, "--runtime"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as Record<string, string>;
}

/** Every bundle (web, host pack, tests) serves the producer's projections from memory, never disk:
 * builtin closures are untracked build output, so a clean checkout needs no generation step. */
export function routeModuleHash(
  generate: () => Promise<Record<string, string> | void> = runtimeRoutes,
): Plugin {
  let test = false;
  let projections: Record<string, string> = {};
  let pending: Promise<void> = Promise.resolve();
  let started = false;
  let refreshing = false;
  let dirty = false;
  let notified: Promise<void> | undefined;
  const update = async () => {
    projections = (await generate()) ?? {};
  };
  const refresh = () => {
    started = true;
    dirty = true;
    if (refreshing) return pending;
    refreshing = true;
    // Edits during verification need one more pass, not one subprocess per event.
    return (pending = (async () => {
      try {
        do {
          dirty = false;
          await update();
        } while (dirty);
      } finally {
        refreshing = false;
      }
    })());
  };
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
    // Rolldown (host pack) never calls this; it projects at buildStart like a Vite build.
    configResolved(config) {
      test = config.command !== "build" && config.mode === "test";
    },
    resolveId(source, importer) {
      // A closure import resolves whether or not a disk copy exists; load serves the projection.
      if (importer && source.endsWith("/source-closure.generated.json"))
        return fileURLToPath(new URL(source, pathToFileURL(importer.split("?")[0]!)));
    },
    async buildStart() {
      // Pure tests need no route closures. Admission imports trigger the same projection.
      if (test) return;
      await refresh();
      // Watch every resolved closure input so a source edit re-projects.
      for (const file of watchFiles()) this.addWatchFile(file);
    },
    async load(id) {
      const filename = id.split("?")[0]!;
      if (
        test &&
        !started &&
        (/[/\\]source-closure\.generated\.json$/.test(filename) ||
          /[/\\]generated[/\\](?:route-directory\.ts|[^/\\]+-graph\.json)$/.test(filename))
      )
        await refresh();
      await pending;
      return projections[filename] ?? projections[filename.replaceAll("/", "\\")];
    },
    async handleHotUpdate({ server }) {
      // The closure includes schemas, codecs, assets and build inputs outside graph.ts.
      // Recompute on every watched source edit; invalid declarations block reload.
      const generation = refresh();
      await generation;
      if (notified === generation) return [];
      notified = generation;
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
