import { z } from "zod";
import { callerSchema } from "./caller.ts";
import { documentRefSchema } from "./target.ts";

/** Immutable causal identity, minted before the harness receives a prompt. */
export const runRefSchema = z.strictObject({ thread: z.string().min(1), turn: z.string().min(1) });
export type RunRef = z.infer<typeof runRefSchema>;
export const allowDecisionSchema = z.strictObject({
  id: z.string().min(1),
  by: z.enum(["human", "deadline"]),
  at: z.string(),
});
export type AllowDecision = z.infer<typeof allowDecisionSchema>;
export const originSchema = z.strictObject({
  caller: callerSchema,
  run: runRefSchema.nullable(),
  root: runRefSchema.nullable(),
  toolCall: z.string().optional(),
});
export type Origin = z.infer<typeof originSchema>;
export const effectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("document"), ref: documentRefSchema }),
  z.strictObject({ kind: z.literal("session"), session: z.string() }),
  z.strictObject({ kind: z.literal("member"), pod: z.string(), path: z.string() }),
  z.strictObject({ kind: z.literal("file"), path: z.string() }),
  // An SDK-owned installation writes/prunes a complete verified destination subtree.
  z.strictObject({ kind: z.literal("directory"), path: z.string() }),
  z.strictObject({ kind: z.literal("receipt"), pod: z.string(), path: z.string() }),
  z.strictObject({ kind: z.literal("publication"), page: z.string() }),
]);
export type Effect = z.infer<typeof effectSchema>;
export const footprintSchema = z.array(effectSchema);
export type Footprint = z.infer<typeof footprintSchema>;
export const commandConsentSchema = z.union([
  z.strictObject({ run: runRefSchema, decision: allowDecisionSchema }),
  z.strictObject({ by: z.literal("press") }),
]);
export type CommandConsent = z.infer<typeof commandConsentSchema>;
export type RunConsent =
  | { state: "idle" }
  | { state: "waiting"; requestId: string; deadline: string; commands: string[] }
  | { state: "allowed"; decision: AllowDecision }
  | {
      state: "closed";
      reason: "completed" | "stopped" | "restart";
      decision: AllowDecision | null;
      at: string;
    };
