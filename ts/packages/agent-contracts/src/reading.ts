import type { HeldElement, ProcessIdentity } from "@pe/host-contracts/pe-revit-contract";
import type { MachineLeg } from "./machine.ts";
import type { SdkSessionSelection } from "./sdk-session.ts";
import { sdkSessionSelectionSchema } from "./sdk-session.ts";
/**
 * Reading — anything observed from Revit, the host, or disk. One subject, one observation time,
 * one lifecycle. Readings arrive on one stream with gap frames. Receipts, inventory, files and
 * captures are Reading kinds, not nouns. A Reading never writes into Work.
 */
import { z } from "zod";
import { actionListFilterSchema } from "./action-receipts.ts";
import { appliedScopeSchema } from "./families.ts";
import { canonicalRouteInput } from "./route-doc.ts";
import { workKey, workKeySchema } from "./route-state.ts";
import { addressSchema, documentRefSchema, sameAddress } from "./target.ts";
import { DUCT_PARAMETER_KEYS } from "./ducts.ts";

/** Acquisition inputs, independent of a Ducts route's local selection and staged calculations. */
export const ductsSnapshotReadingSchema = z.strictObject({
  kind: z.literal("ducts-snapshot"),
  target: documentRefSchema,
  slots: z
    .partialRecord(z.enum(DUCT_PARAMETER_KEYS), z.string().nullable())
    .nullish()
    .transform((value) => value ?? undefined)
    .optional(),
  labelParameter: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined)
    .optional(),
});
export type DuctsSnapshotReading = z.infer<typeof ductsSnapshotReadingSchema>;
export const ductsTablesReadingSchema = z.strictObject({
  kind: z.literal("ducts-tables"),
  session: z.string().min(1),
  ids: z.array(z.string()).max(256),
});
export type DuctsTablesReading = z.infer<typeof ductsTablesReadingSchema>;
export const ductsReadingSchema = z.discriminatedUnion("kind", [
  ductsSnapshotReadingSchema,
  ductsTablesReadingSchema,
]);
export type DuctsReadingRequest = z.infer<typeof ductsReadingSchema>;
export const ductsReadingEnvelopeSchema = z.strictObject({
  revision: z.string(),
  state: z.enum(["idle", "loading", "ready", "stale", "failed", "closed"]),
  version: z.string().nullable(),
  target: documentRefSchema.nullable(),
  session: z.string(),
  error: z.string().optional(),
});
export type DuctsReadingEnvelope = z.infer<typeof ductsReadingEnvelopeSchema>;
export const DUCTS_BODY_VERSION_HEADER = "x-pe-ducts-version";
export const DUCTS_REFRESH_HEADER = "x-pe-ducts-refresh";

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

/**
 * A `families-matrix` snapshot: when the last completed matrix read was taken, and its body's id
 * (`bodyVersion`, the saved observation's content hash). Null until that document and filter are
 * read. An unsaved document has no address, so `at` may be null.
 */
export const familiesMatrixEnvelopeSchema = z
  .object({
    reading: observationSchema.extend({ at: addressSchema.nullable() }),
    bodyVersion: z.string().min(1),
  })
  .nullable();
export type FamiliesMatrixEnvelope = z.infer<typeof familiesMatrixEnvelopeSchema>;

export const familiesReadProgressSchema = z.object({
  runId: z.string(),
  state: z.enum(["reading", "complete", "cancelled", "failed"]),
  phase: z.string(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  workers: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type FamiliesReadProgress = z.infer<typeof familiesReadProgressSchema>;

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
export const sdkStandardReadingSchema = z.strictObject({
  kind: z.literal("sdk"),
  read: z.enum(["sessions", "doctor", "recents", "documents", "dialogs", "logs", "ops"]),
  tail: z.number().int().min(1).max(500).optional(),
  session: sdkSessionSelectionSchema.optional(),
  year: z.string().min(1).optional(),
  all: z.boolean().optional(),
});
export const holdingsReadingSchema = z.strictObject({
  kind: z.literal("sdk"),
  read: z.literal("holdings"),
  section: z.enum(["elements", "worksets"]).default("elements"),
  session: sdkSessionSelectionSchema,
  processStartUtc: z.iso.datetime(),
  openId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional(),
});
export const sdkReadingSchema = z.discriminatedUnion("read", [
  sdkStandardReadingSchema,
  holdingsReadingSchema,
]);
export type HoldingsReading = z.infer<typeof holdingsReadingSchema>;
export type HoldingsReadingResult =
  | { state: "refused"; code: string; detail: string }
  | {
      state: "ok";
      process: ProcessIdentity;
      session: SdkSessionSelection;
      openId: string;
      title: string;
      observedAtUtc: string;
      leg: MachineLeg;
      source: string;
      digest: string;
      empty: boolean;
      savedNotSynced: boolean | null;
      unsaved: boolean;
      workshared: boolean;
      section: "elements" | "worksets";
      total: number;
      elementCount: number;
      worksetCount: number;
      offset: number;
      rows: readonly HeldElement[] | readonly string[];
      nextCursor: string | null;
    };

export type SdkReading = z.infer<typeof sdkReadingSchema>;

export const readingRequestSchema = z.discriminatedUnion("kind", [
  /** Every thread's remembered documents and unfinished Work, one owner-backed batch. */
  z.strictObject({ kind: z.literal("thread-work") }),
  ductsSnapshotReadingSchema,
  ductsTablesReadingSchema,
  z.strictObject({ kind: z.literal("machine") }),
  sdkReadingSchema,
  z.discriminatedUnion("binding", [
    workKeySchema.options[0].extend({ kind: z.literal("work") }),
    workKeySchema.options[1].extend({ kind: z.literal("work") }),
    workKeySchema.options[2].extend({ kind: z.literal("work") }),
    workKeySchema.options[3].extend({ kind: z.literal("work") }),
  ]),
  z.strictObject({ kind: z.literal("thread-head"), thread: z.string().min(1).max(200) }),
  /** Every harness thread's summary, one snapshot per change (coalesced). */
  z.strictObject({ kind: z.literal("threads") }),
  /**
   * One harness thread's events from the host log (`host-log.ts`): each `event` frame is one
   * HarnessEvent and carries its log `id`. With no cursor, or one older than retention, the first
   * frame is a `gap` carrying the cursor: read the thread body, then apply events by `seq`.
   */
  z.strictObject({ kind: z.literal("thread"), thread: z.string().min(1).max(200) }),
  /**
   * The host's card items (`MachineNotice`) from the host log: each `event` frame is one item and
   * carries its log `id`, so a follower that persists the last id replays exactly what it missed.
   * With no cursor, or one the log does not hold, the first frame is a `gap` carrying the log's
   * current id: nothing earlier is owed, follow from there. A `snapshot` frame says whether a tray
   * follows (`{ tray }`); `as: "tray"` marks the one follower that is the tray itself.
   */
  z.strictObject({ kind: z.literal("notices"), as: z.literal("tray").optional() }),
  z.strictObject({ kind: z.literal("takeoff-reading"), target: documentRefSchema }),
  /**
   * The families matrix of one document over one filter, by ENVELOPE only
   * (`familiesMatrixEnvelopeSchema`): the stream says when the last matrix read completed and which
   * body it produced; the client fetches the body over RPC when `bodyVersion` moves (MAP ruling 3).
   */
  z.strictObject({
    kind: z.literal("families-matrix"),
    target: documentRefSchema,
    filter: appliedScopeSchema,
  }),
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
   * One value domain's options (an `x-options.key`) read from one document, with the context
   * values its `dependsOn` names. A LiveDocument key's value names its document, so the host
   * marks it changed; a HostOnly key's value does not, so it carries no mark.
   */
  z.strictObject({
    kind: z.literal("field-options"),
    target: documentRefSchema,
    key: z.string().min(1),
    context: z.record(z.string(), z.string()).optional(),
  }),
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
  /**
   * `id` marks a host log frame: it is the SSE id, and a reconnect resumes after the last one
   * (`?after=<id>` or `Last-Event-ID`). Log frames of every key share one lane in id order; a
   * reader that falls behind it loses the connection, never a frame.
   */
  z.strictObject({
    kind: z.literal("event"),
    key: z.string(),
    value: z.unknown(),
    id: z.number().int().nonnegative().optional(),
  }),
  // null means the connection has no history for the disconnected interval.
  z.strictObject({
    kind: z.literal("gap"),
    key: z.string(),
    dropped: z.number().int().nonnegative().nullable(),
    id: z.number().int().nonnegative().optional(),
  }),
]);
export type ReadingFrame = z.infer<typeof readingFrameSchema>;

/** Named resources invalidated by shared actions; route-local aliases are typed by each manifest. */
export type ActionReadingKey =
  | "snapshot"
  | "takeoff-views"
  | "candidates"
  | "rhvac-open"
  | "receipts"
  | "pods"
  | "family"
  | "families"
  | "parameter-links"
  | "schedules"
  | "sdk"
  | "machine";
