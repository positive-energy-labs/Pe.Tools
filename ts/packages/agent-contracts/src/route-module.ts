import { catalogEntries } from "./pe-api.ts";
import { requireLinkedCatalog, type CatalogAxes } from "./catalog.ts";
import { routeDirectory } from "./generated/route-directory.ts";
import type { z } from "zod";
import type { Command } from "./command.ts";
import type { RouteStateSpec } from "./route-state.ts";
import type { RouteGraph } from "./route-graph.ts";
import { validateRouteGraph } from "./route-graph.ts";

/** The same admission envelope for shipped and Pod-authored route modules. */
export interface RouteModule<B = unknown> {
  version: 1;
  namespace: string;
  key: string;
  moduleHash: string;
  graph: RouteGraph<any, any>;
  bodies: B;
}
export function validateRouteModule(module: RouteModule): void {
  if (module.version !== 1 || !/^[a-z0-9][a-z0-9.-]*$/.test(module.namespace))
    throw Error("Unsupported route registration version or namespace");
  if (module.key !== `${module.namespace}:${module.graph.key}`)
    throw Error("Route registration key must belong to its namespace");
  if (module.namespace !== "builtin" && !module.graph.key.startsWith(`pod.${module.namespace}.`))
    throw Error("A Pod cannot claim another author's route");
  if (!/^[a-f0-9]{64}$/.test(module.moduleHash))
    throw Error("Route registration needs its module SHA-256");
  if (!module.graph.directory) throw Error("Route registration needs a directory declaration");
  const builtin =
    module.namespace === "builtin"
      ? routeDirectory.find((row) => row.key === module.graph.key)
      : undefined;
  if (
    module.namespace === "builtin" &&
    (builtin?.moduleHash !== module.moduleHash || module.graph.moduleHash !== module.moduleHash)
  )
    throw Error("Builtin module hash does not match the generated directory");
  const errors = validateRouteGraph(module.graph);
  if (errors.length)
    throw Error(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
}

/** Executable entries travel with the graph and Work, never as a second installation. */
export interface ExecutableRouteModule<B> extends RouteModule<Record<string, B>> {
  work: RouteStateSpec<z.ZodType>;
  entries: Readonly<Record<string, Command & { axes: CatalogAxes }>>;
}
export function validateExecutableRouteModule<B>(
  module: ExecutableRouteModule<B>,
  actualHash: string,
) {
  validateRouteModule(module);
  if (module.moduleHash !== actualHash) throw Error("Route module hash mismatch");
  for (const [key, entry] of Object.entries(module.entries))
    if (entry.needs !== "nothing" && entry.axes?.subject === "None")
      throw Error(`${key}: a document requirement cannot declare Subject None`);
  requireLinkedCatalog([
    ...catalogEntries,
    ...Object.entries(module.entries).map(([key, entry]) => ({
      ...entry.axes,
      key: `command:${key}`,
      uses: entry.native ?? [],
      ...entry.derivation,
    })),
  ]);
  if (module.work.route !== module.graph.key) throw Error("Work belongs to another route");
  for (const key of Object.keys(module.entries)) {
    if (module.namespace !== "builtin" && !key.startsWith(`pod.${module.namespace}.`))
      throw Error("Catalog key belongs to another author");
    if (!Object.hasOwn(module.bodies, key)) throw Error(`Missing executable body: ${key}`);
  }
  if (Object.keys(module.bodies).some((key) => !Object.hasOwn(module.entries, key)))
    throw Error("Executable body has no catalog entry");
}
/** Host-local admitted projection; consumers never mutate the executable registry. */
export const admittedRouteEntries = new Map<
  string,
  { entries: Readonly<Record<string, Command & { axes: CatalogAxes }>>; available: () => boolean }
>();
