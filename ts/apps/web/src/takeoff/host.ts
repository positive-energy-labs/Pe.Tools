import { z } from "zod";
import {
  readingRequestSchema,
  executionTargetSchema,
  takeoffsRouteState,
  takeoffCaptureSchema,
  takeoffCaptureSummarySchema,
  stagedAdoptChoices,
  candidateRegionSchema,
  documentRefSchema,
  nativeOutputSchema,
} from "@pe/agent-contracts";
import { adoptionArgs, adoptionData, viewCatalogueArgs, viewCatalogueData } from "@pe/agent-contracts/takeoff-read";
import { adoptDrafts } from "@pe/agent-contracts/takeoff-adoption";
import { leaf, read } from "../../../host/src/reads/evaluator.ts";
import { projectTakeoffViews } from "../../../../packages/mcps/src/shared/takeoff-ops.ts";
import { workRead, workBinding, documentMark, nativeRead } from "../../../host/src/reads/inputs.ts";
const captured = leaf("resource", readingRequestSchema, takeoffCaptureSchema.nullable());
export const takeoffSnapshotInput = z.object({
  target: documentRefSchema,
  snapshot: nativeOutputSchema("takeoffs.snapshot"),
  views: z.array(z.object({ name: z.string(), level: z.string() })),
});
const retained = leaf("file:takeoff-capture", takeoffSnapshotInput, takeoffCaptureSchema, false);
const captures = leaf("resource", readingRequestSchema, z.array(takeoffCaptureSummarySchema));
const viewCatalogue = read("takeoffs.views", {
  input: viewCatalogueArgs.extend({ target: executionTargetSchema }),
  output: viewCatalogueData,
  async run(ctx, args) {
    const { target } = args;
    if (target.kind !== "document") throw Error("Choose an open project document");
    await ctx.read(documentMark, target.ref);
    if (args.work) {
      const saved = await ctx.read(captured, { kind: "takeoff-saved", id: args.work });
      if (!saved) throw Error("Saved takeoff capture is unavailable");
      return {
        viewOptions: saved.snapshot.world.lanes.map((row) => ({ id: row.view, label: row.label })),
        capturedViews: [],
      };
    }
    const index = (await ctx.read(nativeRead("revit.catalog.project-index"), {
      target, role: "none", request: {
        sections: ["Views"], includeUnplacedViews: true, projection: { view: "Handles" },
      },
    })).body;
    if (!index.views) throw Error("View catalogue did not return the Views section");
    return {
      viewOptions: index.views.map((row) => ({ id: row.name, label: row.name })),
      capturedViews: projectTakeoffViews(index),
    };
  },
});
export const reads = {
  views: viewCatalogue,
  adoption: read("takeoffs.adoption", {
    input: adoptionArgs.extend({ target: executionTargetSchema }),
    output: adoptionData,
    async run(ctx, args) {
      const { target } = args;
      if (target.kind !== "document") throw Error("Choose an open project document");
      await ctx.read(documentMark, target.ref);
      const key = await ctx.read(workBinding, { route: "takeoffs", target });
      if (!key) throw Error("Takeoffs Work binding is unavailable");
      const work = await ctx.read(workRead("takeoffs", takeoffsRouteState.schema), key);
      const doc = takeoffsRouteState.schema.parse(work?.doc ?? {});
      const saved = args.work
        ? await ctx.read(captured, { kind: "takeoff-saved", id: args.work })
        : null;
      const catalogue = await ctx.read(viewCatalogue, { target, work: args.work });
      const { viewOptions } = catalogue;
      const views = args.views === "all" ? viewOptions.map((row) => row.id) : args.views;
      if (args.zones === "all" && !saved)
        throw Error("The native metadata zone roster is unavailable; choose explicit zones");
      const zones =
        args.zones === "all" ? saved!.snapshot.world.zones.map((row) => row.zone.guid) : args.zones;
      const capture = saved
        ? null
        : await ctx.read(retained, {
            target: target.ref,
            views: catalogue.capturedViews,
            snapshot: (
              await ctx.read(nativeRead("takeoffs.snapshot"), {
                target,
                role: "none",
                request: { views: zones.length ? [] : views, zoneGuids: zones },
              })
            ).body,
          });
      const observation = capture ? { kind: "ready" as const, target: target.ref, capture } : null;
      const snapshot = saved?.snapshot ?? capture?.snapshot;
      const candidates = saved
        ? []
        : (
            await Promise.all(
              views.map((view) =>
                ctx.read(nativeRead("takeoffs.candidates"), {
                  target,
                  role: "none",
                  request: { view },
                }),
              ),
            )
          )
            .flatMap((value) => value.body.regions)
            .map((region) => ({ ...region, role: region.role ?? null, guid: region.guid ?? null }));
      const rows = adoptDrafts(
        candidateRegionSchema.array().parse(candidates),
        stagedAdoptChoices(doc),
      );
      const grouped = new Map<string, { elementId: number; name: string; systemTag: string }[]>();
      for (const row of rows.filter((row) => row.checked))
        grouped.set(row.view, [
          ...(grouped.get(row.view) ?? []),
          {
            elementId: row.region.elementId,
            name: row.name || `${row.view} · ${row.region.elementId}`,
            systemTag: row.systemTag,
          },
        ]);
      const refusal = !work
        ? "Start the takeoff Work first"
        : saved
          ? "Saved captures are inspection only"
          : observation?.kind !== "ready"
            ? "Read the current document first"
            : null;
      return adoptionData.parse({
        takeoffWork: doc,
        handle: work ? { key, revision: work.revision } : null,
        views,
        viewOptions,
        observation,
        saved,
        captures: await ctx.read(captures, { kind: "takeoff-saved" }),
        rows,
        initialize: {
          request: { stage: snapshot?.carriers.stage ?? "Adoption" },
          refusal:
            refusal ??
            (snapshot?.carriers.status === "needs-initialization"
              ? null
              : "The document already carries every shared parameter"),
        },
        adopt: {
          request: grouped.size
            ? { views: [...grouped].map(([view, items]) => ({ view, items })) }
            : null,
          refusal: refusal ?? (grouped.size ? null : "Select regions to adopt"),
        },
      });
    },
  }),
};
