import { z } from "zod";
import type { Read } from "./evaluator.ts";
import { workRead } from "./inputs.ts";
import {
  scheduleCatalog,
  scheduleRetained,
  scheduleSaved,
  scheduleReceipts,
} from "../builtin-read-handles.ts";

import { scheduleGridRouteState, canonicalRouteInput } from "@pe/agent-contracts";
import {
  schedulesViewArgs,
  schedulesViewData,
} from "../../../../packages/agent-contracts/src/schedules-read.ts";
import { read } from "@pe/host/read-graph";
import { documentMark } from "./inputs.ts";
import { scheduleOutcome } from "./schedule-outcome.ts";

/** One selected schedule owns one workspace Work, independently of its native capture. */
export const schedulesView: Read<z.output<typeof schedulesViewArgs>, z.output<typeof schedulesViewData>> = read("schedules.view", {
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
    const view = scope
      ? await ctx.read(workRead("schedules", scheduleGridRouteState.schema), scope)
      : null;
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

export const reads: { view: typeof schedulesView } = { view: schedulesView };
