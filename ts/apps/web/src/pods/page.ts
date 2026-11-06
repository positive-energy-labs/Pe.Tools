import { z } from "zod";
import { routeAddress } from "@pe/agent-contracts";

export const podsPageSchema = routeAddress("pods").schema.extend({
  member: z.string().default(""),
  mode: z.enum(["form", "raw"]).default("form"),
  pendingDraft: z.boolean().default(false),
});
export type PodsPage = z.output<typeof podsPageSchema>;
