import { z } from "zod";
import {
  scheduleReadingSchema,
  scheduleCatalogSchema,
  scheduleGridRouteState,
  workKeySchema,
  actionReceiptListDecoder,
  canonicalRouteInput,
  documentRefSchema,
} from "@pe/agent-contracts";
import {
  schedulesViewArgs,
  schedulesViewData,
} from "../../../../packages/agent-contracts/src/schedules-read.ts";
import { read, leaf, workValue } from "@pe/host/read-graph";
import { documentMark } from "./ducts-inputs.ts";
import { scheduleOutcome } from "./schedule-outcome.ts";
const scheduleCatalog = leaf(
  "resource",
  z.object({
    kind: z.literal("schedule-reading"),
    subject: z.literal("catalog"),
    target: documentRefSchema,
  }),
  scheduleCatalogSchema,
);
const scheduleRetained = leaf(
  "resource",
  z.object({
    kind: z.literal("schedule-reading"),
    subject: z.literal("work"),
    id: z.string().min(1),
  }),
  scheduleReadingSchema.nullable(),
);
const scheduleSaved = leaf(
  "resource",
  z.object({
    kind: z.literal("schedule-reading"),
    subject: z.literal("saved"),
    id: z.string().min(1),
  }),
  scheduleReadingSchema.nullable(),
);
const scheduleReceipts = leaf(
  "resource",
  z.object({ kind: z.literal("receipts"), work: workKeySchema }),
  actionReceiptListDecoder(),
);
/** One selected schedule owns one workspace Work, independently of its native capture. */
export const schedulesView = read("schedules.view", {
  input: schedulesViewArgs,
  output: schedulesViewData,
  async run(ctx, args) {
    await ctx.read(documentMark, args.target);
    const catalog = await ctx.read(scheduleCatalog, {
      kind: "schedule-reading",
      subject: "catalog",
      target: args.target,
    });
    const scope = args.workspaceId
      ? { binding: "workspace" as const, route: "schedules", target: null, work: args.workspaceId }
      : null;
    const view = scope ? workValue.parse(await ctx.work("schedules", scope)) : null;
    const work = scheduleGridRouteState.schema.parse(view?.doc ?? {});
    const retained = args.workspaceId
      ? await ctx.read(scheduleRetained, {
          kind: "schedule-reading",
          subject: "work",
          id: args.workspaceId,
        })
      : null;
    const saved = work.basis
      ? await ctx.read(scheduleSaved, {
          kind: "schedule-reading",
          subject: "saved",
          id: work.basis.captureId,
        })
      : null;
    const receipts = scope
      ? await ctx.read(scheduleReceipts, { kind: "receipts", work: scope })
      : [];
    return ctx.compute(
      schedulesViewData,
      { catalog, work, retained, saved, receipts },
      ({ catalog, work, retained, saved, receipts }) => {
        const reading = retained ?? saved;
        return {
          catalog,
          schedulesWork: work,
          reading,
          saved,
          outcome: scheduleOutcome(receipts),
          editRefusal:
            !reading ||
            !work.basis ||
            work.basis.captureId !== reading.id ||
            reading.workspaceId !== args.workspaceId ||
            canonicalRouteInput(reading.target) !== canonicalRouteInput(args.target)
              ? "Read and bind the schedule in this exact document lifetime before editing"
              : null,
        };
      },
    );
  },
});

export const reads = { view: schedulesView };
