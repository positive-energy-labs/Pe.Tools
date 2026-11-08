import { z } from "zod";
export interface ScheduleOutcome {
  unread: number;
  refused: Readonly<Record<string, string>>;
  readbackError: string | null;
  receiptId: string | null;
}

/** Push failures are host results. Derive them from the receipt; never copy them into Page/Work. */
export function scheduleOutcome(
  rows: readonly {
    key: string;
    id: string;
    startedAt: string;
    result?: unknown;
    refusal?: unknown;
  }[],
): ScheduleOutcome {
  const receipt = rows
    .filter((r) => r.key === "schedule.grid.push")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!receipt) return { unread: 0, refused: {}, readbackError: null, receiptId: null };
  const wrapped = z
    .object({ value: z.unknown() })
    .refine((v) => Object.hasOwn(v, "value"))
    .safeParse(receipt.result);
  const result = z
    .object({
      failures: z.array(z.object({ key: z.string(), error: z.string() })).default([]),
      readbackError: z.string().optional(),
    })
    .safeParse(wrapped.success ? wrapped.data.value : receipt.result);
  const stale = z
    .object({
      kind: z.literal("stale"),
      consumed: z.array(
        z.object({
          kind: z.string(),
          probe: z
            .object({ paths: z.array(z.array(z.union([z.string(), z.number()]))) })
            .optional(),
        }),
      ),
    })
    .safeParse(receipt.refusal);
  const failures = result.success ? result.data.failures : [];
  return {
    unread: result.success && result.data.readbackError ? failures.length : 0,
    refused: Object.fromEntries([
      ...failures.map((f) => [f.key, f.error]),
      ...(stale.success
        ? stale.data.consumed.flatMap((e) =>
            e.kind === "work"
              ? (e.probe?.paths ?? [])
                  .filter((p) => p[0] === "cells" && typeof p[1] === "string")
                  .map((p) => [p[1], "changed since review"])
              : [],
          )
        : []),
    ]),
    readbackError: result.success ? (result.data.readbackError ?? null) : null,
    receiptId: receipt.id,
  };
}
