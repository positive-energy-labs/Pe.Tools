import { z } from "zod";
import { planeViewportSchema } from "@pe/agent-contracts";
/** Drawing pose; typed route.ts owns Page and forwards picked room/card ids as selected. */
export const roomsPageSchema = z.object({
  stage: z.enum(["partition", "review", "history"]).default("partition"),
  view: z.string().default(""),
  layers: z.union([z.array(z.string()), z.literal("all")]).default([]),
  selected: z.union([z.array(z.string()), z.literal("all")]).default([]),
  show: z
    .enum(["all", "proposed", "fail", "stale", "gone", "accepted", "pass"])
    .default("all"),
  viewport: planeViewportSchema.nullable().default(null),
  epoch: z.number().default(0),
});
export type RoomsPage = z.output<typeof roomsPageSchema>;
