import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { build, type InlineConfig, type Plugin } from "vite-plus";
import ts from "typescript";
import { canonicalRouteJson } from "../../packages/agent-contracts/src/route-graph.ts";
import { RouteGraphJson } from "../../packages/agent-contracts/src/route-kernel-data.ts";

/** Text inputs normalize CRLF to LF only; bare CR is significant. Binary assets stay exact. */
export const routeSourceHash = (source: string | Uint8Array) =>
  createHash("sha256")
    .update(
      (typeof source === "string" ? source : Buffer.from(source).toString("utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
    )
    .digest("hex");
const exactHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const textFile = /\.(?:[cm]?[jt]sx?|json|css|html|svg|txt|yaml|yml|toml|md|map)$/;
export interface SourceMember {
  readonly id: string;
  readonly sha256: string;
}
/** Source consistency and exact package bytes are distinct evidence, never interchangeable. */
export type { RouteFingerprintEnvelope as RouteFingerprint } from "../../packages/agent-contracts/src/route-module.ts";
import type { RouteFingerprintEnvelope as RouteFingerprint } from "../../packages/agent-contracts/src/route-module.ts";
export const fingerprintRouteSource = (envelope: RouteFingerprint) =>
  exactHash(Buffer.from(`pe.route.fingerprint.v1\n${canonicalRouteJson(envelope)}`));

export interface BuiltinClosureOptions {
  /** All filesystem arguments are absolute. identityRoot bounds portable manifest identities. */
  readonly root: string;
  readonly identityRoot: string;
  readonly variants: readonly { readonly client: "web" | "pea"; readonly entry: string }[];
  readonly data: unknown;
  /** Resolver/transform config is passed directly to Vite. Never discover config from cwd. */
  readonly config?: InlineConfig;
  readonly externals?: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}

/** Resolve the complete import graph with Vite/Rolldown, discard emitted executables.
 * Module IDs and asset loads come from the resolver, never import-text matching.
 * No builtin runtime pinning: dependencies resolve normally and their content is included.
 */
export async function buildBuiltinClosure(options: BuiltinClosureOptions) {
  for (const path of [options.root, options.identityRoot, ...options.variants.map((v) => v.entry)])
    if (!isAbsolute(path)) throw Error(`Closure requires an absolute path: ${path}`);
  if (
    !options.variants.length ||
    new Set(options.variants.map((v) => v.client)).size !== options.variants.length
  )
    throw Error("Declare one entry per client variant");
  const idFor = (path: string) => {
    const id = relative(options.identityRoot, path).replaceAll("\\", "/");
    if (id === ".." || id.startsWith("../") || isAbsolute(id))
      throw Error(`Source outside identity root: ${path}`);
    return id;
  };
  const member = (path: string): SourceMember => {
    const bytes = readFileSync(path);
    return {
      id: idFor(path),
      sha256: textFile.test(path) ? routeSourceHash(bytes) : exactHash(bytes),
    };
  };
  const modules = new Map<string, SourceMember>();
  const externals = new Map(
    (options.externals ?? []).map((e) => [e.id, { id: e.id, sha256: exactHash(e.bytes) }]),
  );
  if (externals.size !== (options.externals ?? []).length)
    throw Error("Duplicate external integrity");
  // Client labels share one resolver config; identical entries need only one closure build.
  for (const entry of new Set(options.variants.map((variant) => variant.entry))) {
    const capture: Plugin = {
      name: "builtin-source-closure",
      enforce: "pre",
      load(id) {
        const path = id.split("?")[0]!;
        if (isAbsolute(path)) {
          const item = member(path);
          modules.set(item.id, item);
        }
      },
      transform(code, id) {
        // Computed import() and @vite-ignore cannot establish a closed source graph.
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node): void => {
          if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            (!node.arguments[0] ||
              !ts.isStringLiteralLike(node.arguments[0]) ||
              node.getFullText(ast).includes("@vite-ignore"))
          )
            throw Error(`Unresolved dynamic import: ${id}`);
          ts.forEachChild(node, visit);
        };
        visit(ast);
      },
      generateBundle() {
        for (const id of this.getModuleIds()) {
          const info = this.getModuleInfo(id)!;
          if (externals.has(id)) continue;
          if (id.includes("browser-external"))
            throw Error(`External lacks content integrity: ${id}`);
          const path = id.split("?")[0]!;
          if (isAbsolute(path)) {
            const item = member(path);
            modules.set(item.id, item);
          } else {
            // Virtual transforms have no source file. Hash actual resolver-produced code,
            // replacing the explicit root only to avoid checkout-location identities.
            const portable = (info.code ?? "")
              .replaceAll(options.identityRoot.replaceAll("\\", "/"), "<root>")
              .replaceAll(options.identityRoot, "<root>");
            const key = `virtual:${id.replaceAll(options.identityRoot.replaceAll("\\", "/"), "<root>").replaceAll(options.identityRoot, "<root>")}`;
            modules.set(key, { id: key, sha256: routeSourceHash(portable) });
          }
        }
      },
    };
    await build({
      ...options.config,
      configFile: options.config?.configFile ?? false,
      root: options.root,
      logLevel: "silent",
      plugins: [...(options.config?.plugins ?? []), capture],
      build: {
        ...options.config?.build,
        write: false,
        minify: false,
        sourcemap: false,
        lib: { entry, formats: ["es"] },
        rolldownOptions: {
          ...options.config?.build?.rolldownOptions,
          external: [...externals.keys()],
        },
      },
    });
  }
  const sorted = (map: Map<string, SourceMember>) =>
    [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const envelope: Extract<RouteFingerprint, { source: "builtin-closure" }> = {
    source: "builtin-closure",
    version: 1,
    data: RouteGraphJson.parse(options.data),
    variants: options.variants
      .map((v) => ({ client: v.client, entry: idFor(v.entry) }))
      .sort((a, b) => (a.client < b.client ? -1 : 1)),
    modules: sorted(modules),
    // COMMON 27: resolver-loaded modules own identity; config-only files are not members.
    inputs: [],
    externals: sorted(externals),
  };
  return { envelope, fingerprint: fingerprintRouteSource(envelope) };
}

/** Each builtin hashes its own declaration and executable closure. */
export async function buildBuiltinClosures(inventory: readonly BuiltinClosureOptions[]) {
  const closures = new Map<string, Awaited<ReturnType<typeof buildBuiltinClosure>>>();
  for (const options of inventory) {
    const data = RouteGraphJson.parse(options.data);
    if (closures.has(data.key)) throw Error("Duplicate builtin route");
    closures.set(data.key, await buildBuiltinClosure(options));
  }
  return closures;
}

/** Closures are untracked build output; an unchanged rewrite is skipped so watchers stay quiet. */
export function writeBuiltinClosurePin(path: string, text: string) {
  if (existsSync(path) && readFileSync(path, "utf8").replaceAll("\r\n", "\n") === text) return;
  writeFileSync(path, text);
}
