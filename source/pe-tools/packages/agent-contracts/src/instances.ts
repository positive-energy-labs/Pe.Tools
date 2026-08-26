import { z } from "zod";

import { defineRouteState, routeBindingsSchema } from "./route-state.ts";

export const instancesRouteState = defineRouteState({
  route: "instances",
  title: "Instances",
  description: "Manage Revit worlds from a document-scoped route.",
  schema: z.object({
    bindings: routeBindingsSchema,
    stage: z.enum(["declare", "lifecycle"]).optional(),
  }),
  agentWriteMask: [],
  commands: {},
});
export type InstancesRouteDocument = z.infer<typeof instancesRouteState.schema>;
