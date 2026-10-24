import { z } from "zod";
import { documentRefSchema } from "./target.ts";

export const TURN_ELEMENT_NAMES_LIMIT = 256;
export const TURN_ELEMENT_NAME_MAX_LENGTH = 512;
export const TURN_ELEMENT_UNIQUE_ID_MAX_LENGTH = 256;
const pinnedDocumentRefSchema = documentRefSchema.extend({
  session: z.string().min(1).max(256),
  openId: z.string().min(1).max(256),
});
const elementIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** The caller supplies ids, never a replacement document or session. */
export const turnElementNamesRequestSchema = z.strictObject({
  kind: z.literal("turn-element-names"),
  thread: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
  ids: z.array(elementIdSchema).max(TURN_ELEMENT_NAMES_LIMIT),
});
export type TurnElementNamesRequest = z.infer<typeof turnElementNamesRequestSchema>;

/** Host-owned prompt-delivery provenance. Never resolve a named request again at read time. */
export const turnElementNamesSnapshotSchema = z
  .strictObject({
    thread: z.string().min(1).max(200),
    turnId: z.string().min(1).max(200),
    targets: z.array(pinnedDocumentRefSchema.readonly()).max(32).readonly(),
    /** False if even one prompt target could not be pinned to an exact document lifetime. */
    complete: z.boolean(),
  })
  .readonly();
export type TurnElementNamesSnapshot = z.infer<typeof turnElementNamesSnapshotSchema>;

export const turnElementNameSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    elementId: elementIdSchema,
    target: pinnedDocumentRefSchema.readonly(),
    uniqueId: z.string().min(1).max(TURN_ELEMENT_UNIQUE_ID_MAX_LENGTH),
    name: z.string().trim().min(1).max(TURN_ELEMENT_NAME_MAX_LENGTH),
  }),
  z.strictObject({ state: z.literal("ambiguous"), elementId: elementIdSchema }),
  z.strictObject({
    state: z.literal("unresolved"),
    elementId: elementIdSchema,
    reason: z.enum(["targets-unpinned", "no-targets", "read-unavailable", "missing"]),
  }),
]);
export type TurnElementName = z.infer<typeof turnElementNameSchema>;

/** Append to the existing thread event log; this observation grants no execution authority. */
export const turnElementNamesObservationSchema = z.strictObject({
  snapshot: turnElementNamesSnapshotSchema,
  observedAt: z.iso.datetime(),
  entries: z.array(turnElementNameSchema).max(TURN_ELEMENT_NAMES_LIMIT),
});
export type TurnElementNamesObservation = z.infer<typeof turnElementNamesObservationSchema>;
