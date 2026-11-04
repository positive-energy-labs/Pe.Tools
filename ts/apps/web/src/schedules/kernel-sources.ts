import {
  scheduleCatalogSchema,
  scheduleReadingSchema,
  scheduleReads,
  actionReceiptListDecoder,
  workKeySchema,
} from "@pe/agent-contracts";
import { readScheduleCapture } from "../../../../packages/mcps/src/shared/schedule-client";
import { subscriptionSource } from "../shell/readings-use";
import type { ReadingSource } from "../shell/readings";

/** Admitted sources consume only declared args and the attempt's captured target. */
export function schedulesKernelSources(): Record<string, ReadingSource> {
  return {
    "schedules.saved": {
      kind: "use",
      open(ctx, deliver) {
        const id = ctx.args as string | null;
        if (!id) return deliver({ kind: "complete", value: null, revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "schedule-reading", subject: "saved", id }),
          decode: (value) => scheduleReadingSchema.nullable().parse(value),
        }).open(ctx, deliver);
      },
    },
    "schedules.receipts": {
      kind: "use",
      open(ctx, deliver) {
        const work = workKeySchema.nullable().parse(ctx.args);
        if (!work) return deliver({ kind: "complete", value: [], revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "receipts", work }),
          decode: (value) => actionReceiptListDecoder().parse(value),
        }).open(ctx, deliver);
      },
    },
    "schedules.catalog": {
      kind: "use",
      open(ctx, deliver) {
        if (ctx.target.kind !== "document")
          return deliver({ kind: "complete", value: null, revision: 0 });
        const target = ctx.target.ref;
        return subscriptionSource({
          request: () => ({ kind: "schedule-reading", subject: "catalog", target }),
          decode: (value) => scheduleCatalogSchema.nullable().parse(value),
        }).open(ctx, deliver);
      },
    },
    "schedules.retained": {
      kind: "use",
      open(ctx, deliver) {
        const id = ctx.args as string | null;
        if (!id) return deliver({ kind: "complete", value: null, revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "schedule-reading", subject: "work", id }),
          decode: (value) => scheduleReadingSchema.nullable().parse(value),
        }).open(ctx, deliver);
      },
    },
    "schedule.grid.snapshot": {
      kind: "use",
      async open(ctx, deliver) {
        try {
          if (ctx.target.kind !== "document") throw Error("Choose an open project document");
          const value = await readScheduleCapture(
            "schedule.grid.snapshot",
            scheduleReads["schedule.grid.snapshot"].input.parse(ctx.args),
            ctx.target.ref,
          );
          if (!ctx.signal.aborted) deliver({ kind: "complete", value, revision: 0 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
  };
}
