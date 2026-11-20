import { z } from "zod";
import { planeViewportSchema, roomsViewId } from "@pe/agent-contracts";
/** The plan drawing's own page: `route.ts` owns the address, and the workspace hands the open rooms (the subject) in as `selected` carrier GUIDs. */
export const roomsPageSchema = z.object({
  stage: z.enum(["partition", "review", "history"]).default("partition"),
  level: z.string().default(""),
  view: roomsViewId.nullable().default(null),
  layers: z.union([z.array(z.string()), z.literal("all")]).default([]),
  selected: z.union([z.array(z.string()), z.literal("all")]).default([]),
  viewport: planeViewportSchema.nullable().default(null),
});
export type RoomsPage = z.output<typeof roomsPageSchema>;
