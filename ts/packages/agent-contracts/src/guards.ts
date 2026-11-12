import { z } from "zod";

/**
 * The three acts on a project document that Pea does not do without the person (ADR 0038 rule 2).
 * This list is the whole set: nothing else asks. Growing it is a visible edit and the owner's
 * decision. A guarded act never waits inside a tool call: its door returns "held" at once.
 */
export const GUARDED_ACTS = ["synchronize", "overwrite-or-discard", "send-outward"] as const;
export const guardedActSchema = z.enum(GUARDED_ACTS);
export type GuardedAct = z.infer<typeof guardedActSchema>;

/** What a held door tells its caller: the act was not done, and who can do it. Never a person's "no". */
export const heldSchema = z.strictObject({
  kind: z.literal("held"),
  act: guardedActSchema,
  /** Starts with "Held": says what was not done and how the person does it themselves. */
  message: z.string().startsWith("Held"),
});
export type Held = z.infer<typeof heldSchema>;

const WHAT: Record<GuardedAct, string> = {
  synchronize: "Synchronizing with central",
  "overwrite-or-discard": "Overwriting or discarding the model's state",
  "send-outward": "Sending file bytes to an outside service",
};

/** The one wording of a held act. `subject` names the document or file; `how` is the person's own door. */
export const held = (act: GuardedAct, subject: string, how: string): Held => ({
  kind: "held",
  act,
  message: `Held, not done: ${WHAT[act]} is the person's act, and ${subject} was not touched. ${how} The person has not been asked and has not said no: carry on with the rest of the work and tell them this is waiting on them.`,
});

/**
 * An outward send Pea asked for and did not make (guard 3). The person confirms it from its one
 * notice row. A reader holds known bytes; a command held before reading holds its intent instead.
 */
export const heldSendRequestSchema = z.strictObject({
  service: z.literal("llamaparse"),
  /** Local path or URL of the source whose bytes would leave this machine. */
  path: z.string().min(1),
  /** Byte digest for a reader; admission digest for a command held before its source is read. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** LlamaParse `target_pages`, e.g. "1-5", or "all" for a held command. */
  pages: z.string().min(1),
  /** What a held command would write the result to, in the person's words; a reader has none. */
  target: z.string().min(1).optional(),
});
export type HeldSendRequest = z.infer<typeof heldSendRequestSchema>;
export const heldSendSchema = heldSendRequestSchema.extend({
  id: z.string().min(1),
  at: z.string(),
  /** The Pea thread that asked; null for any other caller. */
  thread: z.string().nullable(),
});
export type HeldSend = z.infer<typeof heldSendSchema>;
