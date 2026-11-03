// Temporary legacy registration only. F1/F2/F3/P remove callers; S2 deletes this module.
import type { ReactNode } from "react";
import {
  commandTool,
  validateRouteModule,
  validateRouteGraph,
  type RouteModule,
  type RouteGraph,
  type RouteGraphJson,
  type VerbDecl,
} from "@pe/agent-contracts";

export const legacyBuiltinKeys: readonly string[] = [
  "family",
  "instances",
  "pod-admin",
  "pods",
  "rhvac-sync",
  "rooms",
  "session-admin",
  "settings",
  "takeoffs",
  "zone-audit",
];

/** The discoverable projection of a route's full, typed manifest. */
interface RegisteredManifest {
  readonly key: string;
  readonly name: string;
  readonly work?: object;
  readonly needs?: string;
  readonly verbs?: Readonly<Record<string, VerbDecl>>;
  readonly graph?: RouteGraphJson;
}
type HostedRouteView = (props: {
  thread: string;
  visible: boolean;
  target?: string;
  work?: string;
}) => ReactNode;
interface RouteRegistration {
  readonly manifest: RegisteredManifest;
  /** Present for kernel routes; the manifest is this exact executable graph. */
  readonly graph?: RouteGraph<any, any>;
  readonly hosted: HostedRouteView;
}

/** Temporary enumerated legacy admission; S2 deletes this door. Kernel routes retain closure evidence. */
export function builtinAdmission(graph: RouteGraph<any, any>): string | null {
  if (!legacyBuiltinKeys.includes(graph.key)) return `Unenumerated legacy route: ${graph.key}`;
  if (!graph.directory) return "Route registration needs a directory declaration";
  const errors = validateRouteGraph(graph);
  return errors.length ? errors.map((error) => `${error.path}: ${error.message}`).join("; ") : null;
}

/** One registration owns discovery, action attribution and the actual hosted surface. */
export function createLegacyRouteRegistry() {
  const routes = new Map<string, RouteRegistration>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };

  const registry = {
    /** A refused builtin still registers: its route draws the refusal where a person looks. */
    registerGraph<P, W>(this: void, graph: RouteGraph<P, W>, hosted: HostedRouteView) {
      if (!legacyBuiltinKeys.includes(graph.key))
        throw Error(`Unenumerated legacy route: ${graph.key}`);
      const refusal = builtinAdmission(graph);
      if (refusal) console.error(`Route ${graph.key} refused: ${refusal}`);
      return registry.register({ manifest: graph, graph, hosted });
    },
    registerModule(this: void, module: RouteModule<HostedRouteView>) {
      validateRouteModule(module);
      return registry.register({
        manifest: module.graph,
        graph: module.graph,
        hosted: module.bodies,
      });
    },
    /** Built-in and Pod routes take this one path; the answer removes exactly this registration. */
    register(this: void, registration: RouteRegistration) {
      const key = registration.manifest.key;
      if (!key.trim()) throw Error("a route registration needs its manifest key");
      if (routes.has(key)) throw Error(`route ${key} is already registered`);
      routes.set(key, registration);
      changed();
      return () => {
        if (routes.get(key) !== registration) return;
        routes.delete(key);
        changed();
      };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    keys: () => [...routes.keys()],
    entries: () => [...routes.values()],
    get: (key: string) => routes.get(key),
    actionRoute(this: void, key: string): string | null {
      // The semantic catalogue owns attribution, including supporting commands called inside a
      // graph verb's review. A Pod cannot claim another tool's command by declaring its name.
      const tool = commandTool(key);
      return tool && routes.has(tool.name) ? tool.name : null;
    },
  };
  return registry;
}

// Only this kernel-private door mutates legacy discovery.
const legacy = createLegacyRouteRegistry();
export const legacyRouteDiscovery = Object.freeze({
  subscribe: legacy.subscribe,
  revision: legacy.revision,
  keys: legacy.keys,
  entries: legacy.entries,
  get: legacy.get,
  actionRoute: legacy.actionRoute,
});
export const registerLegacyGraph = legacy.registerGraph;
export const registerLegacyModule = legacy.registerModule;
/** Fixtures use storage without inventing production graph stamps. */
export const registerLegacyRegistration = legacy.register;
