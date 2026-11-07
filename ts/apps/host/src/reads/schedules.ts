import { z } from "zod";
import { scheduleReadingSchema, scheduleCatalogSchema, scheduleGridRouteState, workKeySchema, actionReceiptListDecoder, canonicalRouteInput } from "@pe/agent-contracts";
import { schedulesViewArgs, schedulesViewData } from "../../../../packages/agent-contracts/src/schedules-read.ts";
import { read, leaf } from "./evaluator.ts";
import { documentMark, workValue } from "./ducts-inputs.ts";
import { scheduleOutcome } from "./schedule-outcome.ts";
export const scheduleCatalog = leaf("schedules.catalog", schedulesViewArgs.pick({target:true}), scheduleCatalogSchema, false);
export const scheduleRetained = leaf("schedules.retained", z.string().min(1), scheduleReadingSchema.nullable());
export const scheduleSaved = leaf("schedules.saved", z.string().min(1), scheduleReadingSchema.nullable());
export const scheduleReceipts = leaf("schedules.receipts", workKeySchema, actionReceiptListDecoder());
/** One selected schedule owns one workspace Work, independently of its native capture. */
export const schedulesView = read("schedules.view", {
  input:schedulesViewArgs, output:schedulesViewData,
  async run(ctx,args) {
    await ctx.read(documentMark,args.target);
    const catalog = await ctx.read(scheduleCatalog,{target:args.target});
    const scope = args.workspaceId ? {binding:"workspace" as const,route:"schedules",target:null,work:args.workspaceId} : null;
    const view = scope ? workValue.parse(await ctx.work("schedules",scope)) : null;
    const work = scheduleGridRouteState.schema.parse(view?.doc ?? {});
    const retained = args.workspaceId ? await ctx.read(scheduleRetained,args.workspaceId) : null;
    const saved = work.basis ? await ctx.read(scheduleSaved,work.basis.captureId) : null;
    const receipts = scope ? await ctx.read(scheduleReceipts,scope) : [];
    return ctx.compute(schedulesViewData,{catalog,work,retained,saved,receipts},({catalog,work,retained,saved,receipts})=> {
      const reading = retained ?? saved;
      return {catalog,schedulesWork:work,reading,saved,receipts,outcome:scheduleOutcome(receipts),
        editRefusal: !reading || !work.basis || work.basis.captureId !== reading.id ||
          reading.workspaceId !== args.workspaceId || canonicalRouteInput(reading.target) !== canonicalRouteInput(args.target)
          ? "Read and bind the schedule in this exact document lifetime before editing" : null};
    });
  },
});
