import { z } from "zod";
import { harnessEventSchema } from "./harness-thread.ts";
import { hostLogEntrySchema } from "./host-log.ts";

/** Portable transcript snapshot. Sources retain the exact durable bytes, including tool results. */
export const threadExportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("pea-thread"),
  capturedAt: z.iso.datetime(),
  threadId: z.string(),
  lastSeq: z.number().int().nonnegative(),
  /** Retained delivery history at this capture; full transcript bytes remain below. */
  hostLog: z.object({
    cursor: z.number().int().nonnegative(),
    gap: z.boolean(),
    entries: z.array(hostLogEntrySchema),
  }),
  metadata: z.record(z.string(), z.unknown()),
  events: z.array(harnessEventSchema),
  sources: z.array(
    z.object({
      path: z.enum(["meta.json", "events.jsonl"]),
      present: z.boolean(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      bytesBase64: z.string(),
    }),
  ),
});
export type ThreadExport = z.infer<typeof threadExportSchema>;
