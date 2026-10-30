import { z } from "zod";
import {
  actionReceiptSchema,
  historyRowsSchema,
  scheduleCatalogSchema,
  scheduleReadingSchema,
  workKey,
  type ActionReceipt,
  type ReadingRequest,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { jsonSource } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource, UseSource } from "#/shell/readings";
import type { SchedulesPage } from "./graph";

const page = (ctx: ReadingContext) => ctx.page as SchedulesPage;
const target = (ctx: ReadingContext) => (ctx.target.kind === "document" ? ctx.target.ref : null);

function retained<T>(options: {
  request(ctx: ReadingContext): ReadingRequest | null;
  schema: z.ZodType<T>;
  absent: T;
  key?: (ctx: ReadingContext) => unknown;
}): UseSource<T> {
  return {
    kind: "use",
    key: options.key,
    dirties: ["schedules"],
    open(ctx, deliver) {
      const request = options.request(ctx);
      if (!request) return deliver({ kind: "complete", value: options.absent, revision: 0 });
      return subscriptionSource({
        request: () => request,
        decode: (value) => options.schema.parse(value),
      }).open(ctx, deliver);
    },
  };
}

export interface ScheduleOutcome {
  unread: number;
  refused: Readonly<Record<string, string>>;
  readbackError: string | null;
  receiptId: string | null;
}

/** Push failures are host results. Derive them from the receipt; never copy them into Page/Work. */
export function scheduleOutcome(rows: readonly ActionReceipt[]): ScheduleOutcome {
  const receipt = rows
    .filter((row) => row.key === "schedule.grid.push")
    .reduce<ActionReceipt | undefined>(
      (latest, row) => (!latest || row.startedAt >= latest.startedAt ? row : latest),
      undefined,
    );
  if (!receipt) return { unread: 0, refused: {}, readbackError: null, receiptId: null };
  const raw = ("result" in receipt ? receipt.result : undefined) as { value?: unknown } | undefined;
  const result = (raw && "value" in raw ? raw.value : raw) as
    | {
        failures?: { key: string; error: string }[];
        readbackError?: string;
      }
    | undefined;
  const failures = result?.failures ?? [];
  const stale =
    receipt.refusal?.kind === "stale"
      ? receipt.refusal.consumed.flatMap((entry) =>
          entry.kind === "work"
            ? entry.probe.paths.flatMap((path) =>
                path[0] === "cells" && typeof path[1] === "string"
                  ? [[path[1], "changed since review"] as const]
                  : [],
              )
            : [],
        )
      : [];
  return {
    unread: result?.readbackError ? failures.length : 0,
    refused: Object.fromEntries([...stale, ...failures.map((row) => [row.key, row.error])]),
    readbackError: result?.readbackError ?? null,
    receiptId: receipt.id,
  };
}

export function schedulesSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "schedules.catalog": retained({
      request: (ctx) =>
        target(ctx) ? { kind: "schedule-reading", subject: "catalog", target: target(ctx)! } : null,
      schema: scheduleCatalogSchema.nullable(),
      absent: null,
    }),
    "schedules.retained": retained({
      request: (ctx) =>
        page(ctx).workspaceId
          ? { kind: "schedule-reading", subject: "work", id: page(ctx).workspaceId }
          : null,
      schema: scheduleReadingSchema.nullable(),
      absent: null,
    }),
    "schedules.saved": retained({
      request: (ctx) => {
        const id =
          page(ctx).stage === "history"
            ? page(ctx).captureId
            : ((ctx.work as ScheduleGridDocument | null)?.basis?.captureId ?? page(ctx).captureId);
        return id ? { kind: "schedule-reading", subject: "saved", id } : null;
      },
      key: (ctx) => (ctx.work as ScheduleGridDocument | null)?.basis?.captureId,
      schema: scheduleReadingSchema.nullable(),
      absent: null,
    }),
    "schedules.history": retained({
      request: (ctx) =>
        page(ctx).workspaceId
          ? { kind: "schedule-reading", subject: "history", id: page(ctx).workspaceId }
          : null,
      schema: historyRowsSchema.nullable(),
      absent: null,
    }),
    "schedules.receipts": subscriptionSource({
      request: () => ({ kind: "receipts" }),
      decode: (value) => z.array(actionReceiptSchema).parse(value),
      dirties: ["schedules", "receipts"],
    }),
    "schedules.outcome": {
      kind: "derive",
      key: (ctx) => ctx.workKey,
      derive: (ctx) =>
        scheduleOutcome(
          ((ctx.inputs.receipts?.value ?? []) as ActionReceipt[]).filter(
            (row) =>
              row.consumes.some(
                (input) => input.kind === "work" && workKey(input.probe.handle.key) === ctx.workKey,
              ) ||
              (row.refusal?.kind === "stale_revision" &&
                workKey(row.refusal.handle.key) === ctx.workKey) ||
              (row.refusal?.kind === "stale" &&
                row.refusal.consumed.some(
                  (input) =>
                    input.kind === "work" && workKey(input.probe.handle.key) === ctx.workKey,
                )),
          ),
        ),
    },
    "schedules.pods": {
      ...jsonSource({
        request: () => ({ path: "/call", body: { key: "pod.list", request: {} } }),
        schema: z
          .object({ pods: z.array(z.custom<PodList["pods"][number]>()) })
          .transform((row) => row.pods),
        absent: [],
      }),
      effects: () => [],
      dirties: ["pods"],
    },
  };
}
