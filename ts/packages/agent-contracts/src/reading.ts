/**
 * Reading — anything observed from Revit, the host, or disk. One subject, one observation time,
 * one lifecycle. Readings arrive on one stream with gap frames. Receipts, inventory, files and
 * captures are Reading kinds, not nouns. A Reading never writes into Work.
 */
import { z } from "zod";
import { actionListFilterSchema } from "./action-receipts.ts";
import { canonicalRouteInput } from "./route-doc.ts";
import { workKey, workKeySchema } from "./route-state.ts";
import { addressSchema, documentRefSchema, sameAddress } from "./target.ts";

export { address, addressSchema, sameAddress, type Address } from "./target.ts";

/** One subject observed once: the document it describes, its version, and when it was seen. */
export const observationSchema = z.object({
  at: addressSchema,
  version: z.string().nullable(),
  observedAt: z.iso.datetime(),
});
export type Observation = z.infer<typeof observationSchema>;

/** A persisted read renders only at the document it describes. */
export const here = <A extends { reading: Observation }>(
  value: A | null | undefined,
  at: z.infer<typeof addressSchema> | null,
): A | null => (value && at && sameAddress(value.reading.at, at) ? value : null);

/** Version drift is meaningful only between readings of the same document. */
export const superseded = (older: Observation, newer: Observation): boolean =>
  sameAddress(older.at, newer.at) && older.version !== newer.version;

/* ── The lifecycle every Reading has ──────────────────────────────────────────────────────── */

/**
 * A response for a previous Target cannot land in the current Reading, and a response started
 * before a known invalidation cannot erase it: `previous` carries the last good observation
 * through loading, staleness and failure so a View never has to invent one.
 */
export type Reading<T> =
  | { state: "absent" }
  | { state: "loading"; requestId: string; deadline: number; previous?: T }
  | { state: "ready"; observation: T; changed?: boolean }
  | { state: "stale"; previous: T; reason: "dirtied" | "gap" | "target-changed" | "disconnected" }
  | { state: "failed"; message: string; previous?: T };

/* ── Requests: what a Reading is a reading OF ─────────────────────────────────────────────── */

/** Owner addresses, not a second state model. Projection inputs participate in identity. */
export const sdkReadingSchema = z.strictObject({
  kind: z.literal("sdk"),
  read: z.enum(["sessions", "doctor", "recents", "current"]),
  id: z.string().min(1).optional(),
  year: z.string().min(1).optional(),
  all: z.boolean().optional(),
});
export type SdkReading = z.infer<typeof sdkReadingSchema>;

export const readingRequestSchema = z.discriminatedUnion("kind", [
  sdkReadingSchema,
  workKeySchema.extend({ kind: z.literal("work") }),
  z.strictObject({ kind: z.literal("thread-head"), thread: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal("takeoff-reading"), target: documentRefSchema }),
  /** The current disk identity of one RHVAC project file. */
  z.strictObject({ kind: z.literal("rhvac-file-version"), path: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("family-readings"),
    work: workKeySchema,
  }),
  z.strictObject({
    kind: z.literal("receipts"),
    target: documentRefSchema.optional(),
    id: z.string().min(1).max(200).optional(),
    /** A workspace-scoped receipt list, the same subject `readScopedActionStatuses` reads. */
    scope: actionListFilterSchema.optional(),
  }),
  /**
   * One open document's change mark, for a surface whose read is not a Reading (the `/families`
   * matrix is a one-shot op). The value is empty: the fact is the envelope's `changed`, which the
   * host derives from when it served this Reading. Re-read the surface, `dirty` this, and the
   * host serves it again unchanged.
   */
  z.strictObject({ kind: z.literal("document-mark"), target: documentRefSchema }),
  z.strictObject({ kind: z.literal("inventory") }),
  z.strictObject({ kind: z.literal("world") }),
  /** The host's own liveness. Polled by the host on its own 5s timer, never by a client. */
  z.strictObject({ kind: z.literal("host-status") }),
  /** The one capability catalogue, optionally narrowed to one open document. */
  z.strictObject({ kind: z.literal("capabilities"), doc: z.string().min(1).optional() }),
  /** The generated operation catalogue, optionally for one bridge session. */
  z.strictObject({ kind: z.literal("ops-catalog"), session: z.string().min(1).optional() }),
  z.strictObject({
    kind: z.literal("schedule-reading"),
    target: documentRefSchema.optional(),
    subject: z.enum(["catalog", "work", "saved"]),
    /** The workspace id for `work`, the basis id for `saved`. */
    id: z.string().min(1).optional(),
  }),
  /** An immutable saved takeoff capture by id, or every capture of one document. */
  z.strictObject({
    kind: z.literal("takeoff-saved"),
    id: z.string().min(1).optional(),
    document: z.string().min(1).optional(),
    text: z.boolean().optional(),
  }),
  /** Installed product version and the update the installer offers. */
  z.strictObject({ kind: z.literal("install-status") }),
]);
export type ReadingRequest = z.infer<typeof readingRequestSchema>;

export const READING_MAX_KEYS = 32;
export const READING_MAX_REQUEST_BYTES = 16 * 1024;
export const READING_MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const readingRequestsSchema = readingRequestSchema.array().min(1).max(READING_MAX_KEYS);

export const readingKey = (request: ReadingRequest): string =>
  request.kind === "work"
    ? canonicalRouteInput(["work", workKey(request)])
    : canonicalRouteInput(request);

/* ── Frames: how a Reading moves on the one stream ────────────────────────────────────────── */

export const readingFrameSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("snapshot"),
    key: z.string(),
    value: z.unknown(),
    /**
     * Document-bound Readings only: Revit changed this Reading's document after the host served
     * it. The host owns the mark and the comparison; a surface draws what the envelope says.
     */
    changed: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal("failure"), key: z.string(), error: z.string() }),
  z.strictObject({ kind: z.literal("event"), key: z.string(), value: z.unknown() }),
  // null means the connection has no history for the disconnected interval.
  z.strictObject({
    kind: z.literal("gap"),
    key: z.string(),
    dropped: z.number().int().nonnegative().nullable(),
  }),
]);
export type ReadingFrame = z.infer<typeof readingFrameSchema>;
