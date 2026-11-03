import type {
  Command,
  PodRouteDescriptor,
  RouteGraph,
  RouteStateSpec,
  RouteStatePatch,
} from "./index.ts";
import type { z } from "zod";

/** SHIM: Remove PodModule/register(api) when P3 removes pod-view and its legacy loader tests;
 * P2 has removed the host consumer. New packages export PodRouteAuthoring, never register(api). */
export interface PodModule {
  version: 1;
  namespace: string;
  key: string;
  moduleHash: string;
  graph: RouteGraph<any, any>;
  work: RouteStateSpec<z.ZodType>;
  entries: Record<string, Command & { axes: import("./catalog.ts").CatalogAxes }>;
  operations: Record<
    string,
    {
      key: string;
      input(input: Record<string, unknown>): Record<string, unknown>;
      retires?: (result: unknown) => readonly (readonly string[])[];
    }
  >;
  readings: Record<string, (page: any, work: any) => Record<string, unknown> | null>;
  derives?: Record<string, (page: any, work: any, readings: Record<string, unknown>) => unknown>;
  edits?: Record<string, (work: any, input: any) => readonly RouteStatePatch[]>;
  renderers(ui: { h: Function; kit: any }): Record<string, (props: any) => any>;
}
export interface PodModuleBundle {
  register(
    api: typeof import("./index.ts") & {
      z: typeof import("zod").z;
      descriptor: PodRouteDescriptor;
    },
  ): PodModule;
}
/** Trusted does not mean allowed to invent a second selection or reading owner. */
export function validatePodSource(source: string) {
  if (/\buse(?:State|Reducer|SyncExternalStore)\b/.test(source))
    throw Error("Pod pane bodies cannot own selection or reading state; use kernel props");
}
export function validatePodDeclaration(module: PodModule) {
  if (!module.work?.schema || module.graph.work !== module.work.schema)
    throw Error("Pod routes must author their Work schema; no generic Work fallback");
  for (const [id, pane] of Object.entries(module.graph.panes)) {
    if (!pane.history && !pane.draws.length)
      throw Error(`Pod pane ${id} must declare its readings in draws`);
  }
  for (const entry of Object.values(module.entries)) {
    if (entry.axes.effect === "ModelWrite" && !module.work.schema)
      throw Error("Pod ModelWrite requires an authored Work schema");
  }
}

export function validatePodBundle(bundle: PodModuleBundle) {
  if (Object.keys(bundle).length !== 1 || typeof bundle.register !== "function")
    throw Error("Pod modules export exactly one register function");
}
