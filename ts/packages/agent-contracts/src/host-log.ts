import { z } from "zod";
import { harnessEventSchema } from "./harness-thread.ts";
import { receiptSchema } from "./receipts.ts";

/**
 * The host log: one sequenced, durable, replayable record per host, so every surface sees the same
 * history in the same order. `id` is monotonic across restarts. A reader keeps the last id it
 * applied and resumes after it (`?after=<id>`, or SSE `Last-Event-ID`), so a reconnect neither
 * misses nor double-applies. Retention drops whole old segments: an `after` below the floor reads
 * as a gap, and the reader re-reads its owner's snapshot.
 *
 * Owners keep their own truth (the thread's `events.jsonl`, the receipt journal); the log orders
 * what they committed. An entry larger than {@link HOST_LOG_MAX_ENTRY_BYTES} is kept as an
 * `oversize` pointer naming where the whole value lives.
 */
export const HOST_LOG_MAX_ENTRY_BYTES = 256 * 1024;

export const hostEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("thread"), thread: z.string(), event: harnessEventSchema }),
  z.strictObject({ kind: z.literal("receipt"), receipt: receiptSchema }),
  z.strictObject({
    kind: z.literal("oversize"),
    of: z.enum(["thread", "receipt"]),
    /** `thread` + `seq` for a thread event, `id` + `revision` for a receipt. */
    ref: z.record(z.string(), z.union([z.string(), z.number()])),
    bytes: z.number().int().positive(),
  }),
]);
export type HostEvent = z.infer<typeof hostEventSchema>;

export const hostLogEntrySchema = z.strictObject({
  id: z.number().int().positive(),
  at: z.iso.datetime(),
  event: hostEventSchema,
});
export type HostLogEntry = z.infer<typeof hostLogEntrySchema>;

/**
 * `GET /pe/log?after=<id>&kind=&thread=&limit=`: one bounded page of the log in id order. Resume
 * from `next`; `more` says the page stopped at `limit`; `gap` says retention dropped entries after
 * `after`, so re-read the owner's snapshot first.
 */
export const HOST_LOG_PAGE_MAX = 1000;
export const hostLogPageSchema = z.strictObject({
  entries: z.array(hostLogEntrySchema),
  gap: z.boolean(),
  next: z.number().int().nonnegative(),
  more: z.boolean(),
});
export type HostLogPage = z.infer<typeof hostLogPageSchema>;
