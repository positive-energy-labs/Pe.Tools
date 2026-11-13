import { z } from "zod";
import { callerSchema } from "./caller.ts";
import { workKeySchema } from "./route-state.ts";

/**
 * The host Timeline (ADR 0042): one ordered list of steps across the Works of a Place, one read
 * (`work.timeline`) and one step door (`work.history`). A person and Pea use the same door.
 */

/** The step the host would take now, for this caller. A home save has no Work, so it is its own arm. */
export const stepRefSchema = z.union([
  z.strictObject({ work: workKeySchema, revision: z.number().int().nonnegative(), label: z.string() }),
  z.strictObject({ home: z.string().min(1), sha256: z.string().min(1), label: z.string() }),
]);
export type StepRef = z.infer<typeof stepRefSchema>;

const by = z.enum(["human", "pea"]);

/** One successful `writeHome` by a command, as this machine recorded it (storage C3). */
export const homeWriteRowSchema = z.strictObject({
  kind: z.literal("home-write"),
  /** Words a person reads: "ducts designFriction at project (Chadds Ford Residence)". */
  place: z.string(),
  path: z.string(),
  sha256: z.string(),
  /** null: the file was new; the source must restore absence safely or state why undo is refused. */
  priorSha256: z.string().nullable(),
  by: callerSchema,
  at: z.string(),
  /** The settings owner or pod id the file belongs to. */
  owner: z.string(),
  tier: z.enum(["user", "project", "firm"]),
  /** The home root the file sits in. */
  home: z.string(),
});
export type HomeWriteRow = z.infer<typeof homeWriteRowSchema>;

/** Row identity: `work` plus `revision` for edit and restore, `id` for receipt and point, `path` plus `sha256` for a home write. */
export const timelineRowSchema = z.union([
  z.strictObject({
    kind: z.enum(["edit", "restore"]),
    work: workKeySchema,
    revision: z.number().int().nonnegative(),
    by,
    label: z.string(),
    state: z.enum(["applied", "undone", "superseded", "blocked"]),
    /** Why undo stops here, when it does. */
    blockedBy: z
      .union([
        z.strictObject({ receipt: z.string(), label: z.string() }),
        z.strictObject({ reason: z.string() }),
      ])
      .optional(),
    at: z.number(),
  }),
  z.strictObject({
    kind: z.literal("receipt"),
    id: z.string(),
    work: workKeySchema.nullable(),
    label: z.string(),
    by,
    state: z.string(),
    // ponytail: Sight's `Touched` (sight.md C2) has no TS type yet; k2/evidence-ts narrows this.
    touched: z.unknown().optional(),
    at: z.number(),
  }),
  z.strictObject({
    kind: z.literal("point"),
    id: z.string(),
    reason: z.enum(["captured", "afterWrite", "synced"]),
    receipt: z.string().optional(),
    at: z.number(),
  }),
  homeWriteRowSchema.extend({ undoable: z.boolean() }),
]);
export type TimelineRow = z.infer<typeof timelineRowSchema>;

export const workTimelineSchema = z.strictObject({
  /** Host order is the order; a reader never sorts by `at`. */
  rows: z.array(timelineRowSchema).readonly(),
  undo: stepRefSchema.nullable(),
  redo: stepRefSchema.nullable(),
  /** Why this caller has no step in that direction, or why the next one is refused. */
  refusal: z.strictObject({ undo: z.string().nullable(), redo: z.string().nullable() }),
});
export type WorkTimeline = z.infer<typeof workTimelineSchema>;

/** Args of the read. The host adds the document's findings Work itself. */
export const workTimelineArgsSchema = z.strictObject({ works: z.array(workKeySchema).readonly() });
export type WorkTimelineArgs = z.infer<typeof workTimelineArgsSchema>;

/** Body of `work.history`. The host refuses when `expected` is not the step it would take. */
export const workStepRequestSchema = z.strictObject({
  direction: z.enum(["undo", "redo"]),
  works: z.array(workKeySchema).readonly(),
  expected: stepRefSchema,
});
export type WorkStepRequest = z.infer<typeof workStepRequestSchema>;

/** The read's key, published through the one value door. */
export const WORK_TIMELINE_READ = "work.timeline";
