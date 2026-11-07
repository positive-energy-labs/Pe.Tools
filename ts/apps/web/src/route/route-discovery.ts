import { z } from "zod";
import {
  commands,
  commandTool,
  type Command,
  type CellsDecl,
  type RouteGraph,
} from "@pe/agent-contracts";
import type {
  AdmittedRoute,
  RouteFingerprint,
} from "../../../../packages/agent-contracts/src/route-kernel-admission";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { legacyRouteDiscovery } from "../shell/legacy-route-door";

export type WorkAdmission = { routeKey: string; fingerprint: RouteFingerprint };

/** Read-only projection; the graph or exact admission remains the authority. */
export interface DiscoveredWork<W = any> {
  route: string;
  schema: z.ZodType<W>;
  cells: readonly CellsDecl<W>[];
  workFields: RouteGraph<any, W>["workFields"];
  admission?: WorkAdmission;
}
type Legacy = ReturnType<typeof legacyRouteDiscovery.entries>[number];
export type DiscoveredRoute = Omit<Legacy, "manifest"> & {
  manifest: Pick<Legacy["manifest"], "key" | "name" | "needs">;
  admitted?: AdmittedRoute;
  work?: DiscoveredWork;
};
export const legacyWork = <W>(
  graph: RouteGraph<any, W> | undefined,
): DiscoveredWork<W> | undefined =>
  graph?.work
    ? {
        route: graph.workRoute ?? graph.key,
        schema: graph.work,
        cells: graph.cells ?? [],
        workFields: graph.workFields,
      }
    : undefined;

export function admittedWork(route: AdmittedRoute): DiscoveredWork | undefined {
  if (!route.resolvedWork) return;
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(route);
  try {
    const bindings = resolveRouteBindings(registry, route)!;
    const cells = Object.values(route.data.cells).map((cell): CellsDecl<any> => {
      const key = (value: string) => (cell.key ? bindings.schemas[cell.key]!.parse(value) : value);
      return {
        segment: cell.segment,
        ...(cell.segment === null && { key: cell.key }),
        groupOf: (value) =>
          z.array(z.string()).parse(bindings.bodies[cell.groupOf]!.run(key(value))),
        ...(cell.label && {
          label: (value: string) => z.string().parse(bindings.bodies[cell.label!]!.run(value)),
        }),
        ...(cell.show && {
          show: (value: unknown) =>
            z
              .string()
              .parse(bindings.bodies[cell.show!]!.run(bindings.schemas[cell.value]!.parse(value))),
        }),
        ...(cell.focus && {
          focus: (value: string) =>
            z.record(z.string(), z.string()).parse(bindings.bodies[cell.focus!]!.run(key(value))),
        }),
      };
    });
    return {
      route: route.resolvedWork.spec.route,
      schema: route.resolvedWork.schema,
      cells,
      workFields: Object.fromEntries(
        Object.entries(route.data.workFields).map(([key, field]) => [
          key,
          { label: field.label, ...(field.internal && { internal: true as const }) },
        ]),
      ),
      admission: { routeKey: route.resolvedWork.spec.route, fingerprint: route.workFingerprint },
    };
  } finally {
    registration.deactivate();
  }
}

/** An authenticated admitted handle, builtin or trusted Pod: one registration feeds mount and discovery. */
export type RegisteredRoute = DiscoveredRoute & (
  { admitted: AdmittedRoute } | { typed: import("./typed-route").TypedRoute }
);

/**
 * The one route registration projection. Builtins and trusted Pods register the same way; trust stays
 * the admission authority (a Pod handle exists only after artifact admission). Admitted registrations
 * win a cutover; legacy entries remain discoverable until ported.
 */
export function createRouteDiscovery(legacy = legacyRouteDiscovery) {
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const registry = createAdmittedRouteRegistry();
  const registered = new Map<string, RegisteredRoute>();
  const entries = (): DiscoveredRoute[] => {
    const next = new Map(
      legacy
        .entries()
        .map((entry) => [
          entry.manifest.key,
          { ...entry, work: legacyWork(entry.graph) } as DiscoveredRoute,
        ]),
    );
    for (const entry of registered.values()) next.set(entry.manifest.key, entry);
    return [...next.values()];
  };
  return Object.freeze({
    /** Withdraw returns only this exact handle; a retired handle cannot register again. */
    register(entry: RegisteredRoute): () => void {
      const key = entry.manifest.key;
      if (registered.has(key)) throw Error(`Route ${key} already registered`);
      const receipt = entry.admitted ? registry.register(entry.admitted) : null;
      registered.set(key, entry);
      changed();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (registered.get(key) === entry) registered.delete(key);
        receipt?.deactivate();
        changed();
      };
    },
    /** The registered handle, resolved through its live receipt; null once withdrawn. */
    admitted: (key: string): AdmittedRoute | null => {
      const entry = registered.get(key);
      return entry?.admitted ? registry.resolve(entry.admitted) : null;
    },
    /** Catalog metadata for either executable module; this is never mount authority. */
    declaration: (key: string) => {
      const entry = registered.get(key);
      return entry?.admitted?.data ?? (entry && "typed" in entry ? entry.typed.data : null);
    },
    /** The route whose authenticated declaration owns this address. */
    byAddress: (address: string) =>
      [...registered.values()].find((entry) =>
        (entry.admitted?.data.address ?? ("typed" in entry ? entry.typed.data.address : null)) === address),
    subscribe(listener: () => void) {
      listeners.add(listener);
      const stop = legacy.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    revision: () => revision + legacy.revision(),
    entries,
    keys: () => entries().map(({ manifest }) => manifest.key),
    get: (key: string) => entries().find(({ manifest }) => manifest.key === key),
    actionRoute(key: string) {
      const command: Command | undefined = commands[key as keyof typeof commands];
      const owner = command?.work?.route ?? commandTool(key)?.name;
      // A Work owner need not have a Page (ADR 0030 rule 2); its record keeps the receipt.
      return owner && entries().some(({ manifest }) => manifest.key === owner) ? owner : null;
    },
  });
}

/**
 * The app's one registration projection. It lives here, apart from the builtin inventory, so a route
 * graph's import tree (navigation reads it) never pulls in builtin closures.
 */
export const publicRoutes = createRouteDiscovery();
