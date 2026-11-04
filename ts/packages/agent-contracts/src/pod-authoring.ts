import type { RouteModule } from "./route-kernel-admission.ts";
import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { SchemaTable } from "./route-kernel-page.ts";
import type { EntryTable } from "./route-kernel-bodies.ts";
export { z } from "zod";

/** Export `module` with data and typed bindings, then publish with publishPodRoute.
 * The generic producer supplies artifact evidence; authors never hash bodies or register graphs.
 * Schemas, codecs, sources, renderers and Work migrations ship in one verified executable closure. */
export type PodRouteAuthoring<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  Render = unknown,
> = Omit<RouteModule<G, S, E, Render>, "artifact">;
