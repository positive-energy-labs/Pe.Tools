import { z } from "zod";
import { callerSchema } from "./caller.ts";
import { documentRefSchema } from "./target.ts";

/** Immutable causal identity, minted before the harness receives a prompt. */
export const runRefSchema = z.strictObject({ thread: z.string().min(1), turn: z.string().min(1) });
export type RunRef = z.infer<typeof runRefSchema>;
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
  z.strictObject({
    kind: z.literal("member"),
    pod: z.string(),
    path: z.string(),
    location: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("file"), path: z.string() }),
  // An SDK-owned installation writes/prunes a complete verified destination subtree.
  z.strictObject({ kind: z.literal("directory"), path: z.string() }),
  z.strictObject({ kind: z.literal("publication"), page: z.string() }),
]);
export type Effect = z.infer<typeof effectSchema>;
export const footprintSchema = z.array(effectSchema);
export type Footprint = z.infer<typeof footprintSchema>;
/**
 * A run in the host's registry (ADR 0038): open while its turn may act, closed by its end, a Stop
 * or a host restart. Nothing waits on a person here; a guarded act returns "held" (`guards.ts`).
 */
export type RegisteredRun =
  | { state: "open" }
  | { state: "closed"; reason: "completed" | "failed" | "stopped" | "restart"; at: string };
