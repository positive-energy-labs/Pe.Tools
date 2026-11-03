import { z } from "zod";
import { commandTool, type CellsDecl, type RouteGraph } from "@pe/agent-contracts";
import type {
  AdmittedRoute,
  RouteFingerprint,
} from "../../../../packages/agent-contracts/src/route-kernel-admission";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { legacyRouteDiscovery } from "../shell/legacy-route-door";

/** Read-only projection; the graph or exact admission remains the authority. */
export interface DiscoveredWork<W = any> {
  route: string;
  schema: z.ZodType<W>;
  cells: readonly CellsDecl<W>[];
  workFields: RouteGraph<any, W>["workFields"];
  admission?: { routeKey: string; fingerprint: RouteFingerprint };
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

/** Admitted registrations win a cutover; legacy entries remain discoverable until ported. */
export function createRouteDiscovery(
  admitted: () => readonly DiscoveredRoute[],
  legacy = legacyRouteDiscovery,
) {
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const entries = (): DiscoveredRoute[] => {
    const next = new Map(
      legacy
        .entries()
        .map((entry) => [
          entry.manifest.key,
          { ...entry, work: legacyWork(entry.graph) } as DiscoveredRoute,
        ]),
    );
    for (const entry of admitted()) next.set(entry.manifest.key, entry);
    return [...next.values()];
  };
  return Object.freeze({
    changed,
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
      const tool = commandTool(key);
      return tool && entries().some(({ manifest }) => manifest.key === tool.name)
        ? tool.name
        : null;
    },
  });
}
