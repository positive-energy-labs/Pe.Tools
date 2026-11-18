import { z } from "zod";

/**
 * The two acts on a project document that Pea does not do without the person (ADR 0038 and ADR 0052).
 * This list is the whole set: nothing else asks. Growing it is a visible edit and the owner's
 * decision. A guarded act never waits inside a tool call: its door returns "held" at once.
 */
export const GUARDED_ACTS = ["synchronize", "overwrite-or-discard"] as const;
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
};

/** The one wording of a held act. `subject` names the document or file; `how` is the person's own door. */
export const held = (act: GuardedAct, subject: string, how: string): Held => ({
  kind: "held",
  act,
  message: `Held, not done: ${WHAT[act]} is the person's act, and ${subject} was not touched. ${how} The person has not been asked and has not said no: carry on with the rest of the work and tell them this is waiting on them.`,
});
