import { workRead } from "./inputs.ts";
import { nativeRead } from "./inputs.ts";
import { familyObservation, familyReceipts } from "../builtin-read-handles.ts";
import { z } from "zod";
import { familiesRouteState, canonicalRouteInput, actionReceiptSchema } from "@pe/agent-contracts";
import {
  familiesViewArgs,
  familiesViewData,
} from "../../../../packages/agent-contracts/src/families-read.ts";
import { read, workScope } from "@pe/host/read-graph";
import { documentMark } from "./inputs.ts";
import { applyOutcome, applyTally } from "./families-outcome.ts";
import { matrixModel, buildPivot } from "./families-matrix.ts";

/** Immutable native evidence, Work and matrix calculation meet only on the host. */
export const familiesView = read("families.view", {
  input: familiesViewArgs,
  output: familiesViewData,
  async run(ctx, args) {
    await ctx.read(documentMark, args.target);
    const scope = { ...(await ctx.read(workScope, args.target)), route: "families" };
    const view = await ctx.read(workRead("families", familiesRouteState.schema), scope);
    const work = familiesRouteState.schema.parse(view?.doc ?? {});
    const { body: catalog } = await ctx.read(nativeRead("revit.catalog.loaded-families"), {
      role: "none",
      request: { filter: {}, budget: { maxEntries: 5000 } },
      target: { kind: "document", ref: args.target },
    });
    const observed = await ctx.read(familyObservation, { kind: "families-reading", work: scope });
    const filter = work.scope.edit?.value;
    const observation =
      observed &&
      canonicalRouteInput(observed.document) === canonicalRouteInput(args.target) &&
      canonicalRouteInput(observed.filter) === canonicalRouteInput(filter)
        ? observed
        : null;
    const receipts = await ctx.read(familyReceipts, { kind: "receipts", work: scope });
    return ctx.compute(
      familiesViewData,
      { work, catalog, observation, receipts },
      ({ work, catalog, observation, receipts }) => {
        const families = observation?.result.families ?? [];
        const { rows, params } = matrixModel(families);
        const pivot = buildPivot(rows, params, families);
        return {
          familiesWork: work,
          catalog: {
            ...catalog,
            families: catalog.families.filter(
              (f) =>
                !work.scope.edit?.value.categoryNames.length ||
                work.scope.edit.value.categoryNames.includes(f.categoryName ?? ""),
            ),
          },
          observation,
          rows,
          params,
          ...pivot,
          outcomes: receipts
            .filter((r) => r.key === "families.apply")
            .map((r) => {
              const outcome = applyOutcome(
                actionReceiptSchema.parse(r),
                work.scope.edit?.value.familyNames ?? [],
              );
              const tally =
                r.state === "succeeded" ? applyTally(actionReceiptSchema.parse(r)) : null;
              return {
                id: r.id,
                kind: outcome ? ("error" as const) : ("advisory" as const),
                message: outcome?.message ?? `${tally?.converged ?? 0} families converged`,
              };
            }),
          activeReadId: (() => {
            const running = receipts
              .filter((r) => r.key === "families.read" && ["running", "waiting"].includes(r.state))
              .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
            const input = z.object({ readId: z.uuid() }).safeParse(running?.input);
            return input.success
              ? input.data.readId
              : observation?.progress?.state === "reading"
                ? observation.progress.runId
                : null;
          })(),
          categories: [
            ...new Set(catalog.families.flatMap((f) => (f.categoryName ? [f.categoryName] : []))),
          ].sort(),
          editRefusal:
            !observation ||
            observation.capturedAt !== work.takenAt ||
            (observation.progress && observation.progress.state !== "complete")
              ? "Read these families before editing"
              : null,
        };
      },
    );
  },
});

export const reads = { view: familiesView };
