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
  if (!/^[a-f0-9]{64}$/.test(module.moduleHash)) throw Error("Route registration needs its module SHA-256");
  if (!module.graph.directory) throw Error("Route registration needs a directory declaration");
  const errors = validateRouteGraph(module.graph);
  if (errors.length) throw Error(errors.map(error => `${error.path}: ${error.message}`).join("; "));
}
