import { z } from "zod";

import { routeBindingsSchema, type RouteStateSpec } from "./route-state.ts";

export const opsReceiptSchema = z.object({
  opKey: z.string(),
  request: z.unknown().optional(),
  value: z.unknown(),
  elapsedMs: z.number().nonnegative(),
  target: z.string(),
  observedAt: z.iso.datetime(),
});
export type OpsReceipt = z.infer<typeof opsReceiptSchema>;

const opsDocumentSchema = z.object({
  bindings: routeBindingsSchema,
  receipt: opsReceiptSchema.nullable().default(null),
});

export const opsRouteState = {
  route: "ops",
  title: "Operations",
  description: "Explore the live Host operation catalog and retain the last bound receipt.",
  schema: opsDocumentSchema,
  agentWriteMask: [],
  commands: {},
} satisfies RouteStateSpec<typeof opsDocumentSchema>;
export type OpsRouteDocument = z.infer<typeof opsRouteState.schema>;
