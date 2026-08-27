import { z } from "zod";

import { routeBindingsSchema, type RouteStateSpec } from "./route-state.ts";

const instancesDocumentSchema = z.object({
  bindings: routeBindingsSchema,
});

export const instancesRouteState = {
  route: "instances",
  title: "Instances",
  description: "Manage Revit worlds from a document-scoped route.",
  schema: instancesDocumentSchema,
  agentWriteMask: [],
  commands: {},
} satisfies RouteStateSpec<typeof instancesDocumentSchema>;
export type InstancesRouteDocument = z.infer<typeof instancesRouteState.schema>;
