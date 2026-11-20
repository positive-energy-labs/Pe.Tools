import { currentRouteStartupProjection, readRouteStartupReceipt } from "./route-startup.ts";
import type { RouteStartupProjection } from "./route-startup.ts";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Plugin } from "vite-plus";
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

/** Test lane only (vite.config.ts `mode === "test"`). Every web test file reaches the producer through
 * @pe/agent-contracts -> generated/route-directory.ts, and one producer run costs minutes and ~2 GiB.
 * Reuse the receipt the producer's last full run stored, only while `currentRouteStartupProjection`
 * (the source-hash plus closure-member check the dev host trusts) says it is current. Any miss runs
 * the producer, which stays the authority and stores the next receipt. */
export const cachedRuntimeRoutes = async () =>
  readRouteStartupReceipt(fileURLToPath(new URL("../../../", import.meta.url)))?.projections ??
  runtimeRoutes();

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
