import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { familiesRouteState, familiesObservationSchema, workKeySchema, canonicalRouteInput, actionReceiptListDecoder } from "@pe/agent-contracts";
import { familiesViewArgs, familiesViewData } from "../../../../packages/agent-contracts/src/families-read.ts";
import { read, leaf } from "./evaluator.ts";
import { documentMark, workScope, workValue } from "./ducts-inputs.ts";
import { matrixModel, buildPivot } from "./families-matrix.ts";

export const familyCatalog = leaf("families.catalog", familiesViewArgs, nativeResponseSchema("revit.catalog.loaded-families"), false);
export const familyObservation = leaf("families.observation", workKeySchema, familiesObservationSchema.nullable());
export const familyReceipts = leaf("families.receipts", workKeySchema, actionReceiptListDecoder());
/** Immutable native evidence, Work and matrix calculation meet only on the host. */
export const familiesView = read("families.view", {
  input: familiesViewArgs, output: familiesViewData,
  async run(ctx, args) {
    await ctx.read(documentMark, args.target);
    const scope = {...await ctx.read(workScope, args.target),route:"families"};
    const view = workValue.parse(await ctx.work("families", scope));
    const work = familiesRouteState.schema.parse(view?.doc ?? {});
    const catalog = await ctx.read(familyCatalog, args);
    const observed = await ctx.read(familyObservation, scope);
    const filter = work.scope.edit?.value;
    const observation = observed && canonicalRouteInput(observed.document) === canonicalRouteInput(args.target) &&
      canonicalRouteInput(observed.filter) === canonicalRouteInput(filter) ? observed : null;
    const receipts = await ctx.read(familyReceipts, scope);
    return ctx.compute(familiesViewData, {work,catalog,observation,receipts}, ({work,catalog,observation,receipts}) => {
      const families = observation?.result.families ?? [];
      const {rows, params} = matrixModel(families);
      const pivot = buildPivot(rows,params,families);
      return {familiesWork:work, catalog:{...catalog,families:catalog.families.filter(f=>!work.scope.edit?.value.categoryNames.length || work.scope.edit.value.categoryNames.includes(f.categoryName ?? ""))}, observation, receipts, rows, params, ...pivot,
        categories:[...new Set(catalog.families.flatMap(f=>f.categoryName?[f.categoryName]:[]))].sort(),
        editRefusal: !observation || observation.capturedAt !== work.takenAt ||
          observation.progress && observation.progress.state !== "complete"
          ? "Read these families before editing" : null};
    });
  },
});
