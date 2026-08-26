import { z } from "zod";

import { defineRouteState, routeBindingSchema } from "./route-state.ts";

export const opsReceiptSchema = z.object({
  opKey: z.string(),
  request: z.unknown().optional(),
  value: z.unknown(),
  elapsedMs: z.number().nonnegative(),
  target: z.string(),
  observedAt: z.iso.datetime(),
});
export type OpsReceipt = z.infer<typeof opsReceiptSchema>;

export const opsRouteState = defineRouteState({
  route: "ops",
  title: "Operations",
  description: "Explore the live Host operation catalog and retain the last bound receipt.",
  schema: z.object({
    binding: routeBindingSchema,
    receipt: opsReceiptSchema.nullable().default(null),
  }),
  agentWriteMask: [],
  commands: {},
});
export type OpsRouteDocument = z.infer<typeof opsRouteState.schema>;
