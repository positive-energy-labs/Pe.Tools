import { rhvacFileVersionSchema } from "@pe/agent-contracts";
import { readTable } from "../../../../packages/mcps/src/shared/query-client";
import { takeoffReads, readTakeoff, takeoffReadScope } from "./queries";
import { z } from "zod";
import {
  actionReceiptSchema,
  candidateRegionSchema,
  takeoffCaptureSummarySchema,
  takeoffObservationSchema,
  type TakeoffCapture,
  type TakeoffObservation,
  type TakeoffModel,
} from "@pe/agent-contracts";

import { callOp, composeSource } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource } from "#/shell/readings";
import type { TakeoffGraphPage } from "./graph";
import { selectedTakeoffPage, type TakeoffRoster } from "./subject";
import { snapshotOfObservation } from "./actions";
import { planOf, planView, type OwnerCrop } from "./plan";

const rawPage = (ctx: ReadingContext) => ctx.page as TakeoffGraphPage;
const page = (ctx: ReadingContext) =>
  selectedTakeoffPage(
    ctx.page as TakeoffGraphPage,
    ctx.inputs.roster?.value as TakeoffRoster | undefined,
  );
const worldOf = (ctx: ReadingContext): TakeoffModel | undefined =>
  rawPage(ctx).work
    ? (ctx.inputs.saved?.value as TakeoffCapture | undefined)?.snapshot.world
    : snapshotOfObservation(
        (ctx.inputs.snapshot?.value ?? ctx.inputs.snapshot?.previous) as
          | TakeoffObservation
          | undefined,
      )?.world;
const levelOf = (ctx: ReadingContext) => {
  const world = worldOf(ctx);
  const p = page(ctx);
  return (
    p.level ||
    world?.lanes.find((lane) => lane.view === p.views[0])?.label ||
    world?.lanes[0]?.label ||
    ""
  );
};
export function takeoffSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "takeoffs.roster": {
      kind: "use",
      async open(ctx, deliver) {
        const saved = ctx.inputs.saved?.value as TakeoffCapture | undefined;
        const index =
          !saved && ctx.target.kind === "document"
            ? await callOp(ctx, "revit.catalog.project-index", {
                sections: ["Views"],
                includeUnplacedViews: true,
                projection: { view: "Handles" },
              })
            : null;
        const world = saved?.snapshot.world;
        deliver({
          kind: "complete",
          revision: 1,
          value: {
            views: world
              ? world.lanes.map((row) => ({ id: row.view, label: row.label }))
              : (index?.views ?? []).map((row) => ({ id: row.name, label: row.name })),
            zonesComplete: !!saved,
            zones: (world?.zones ?? []).map((row) => ({ id: row.zone.guid, label: row.name })),
          },
        });
      },
    },
    "takeoffs.snapshot": {
      kind: "use",
      dirties: ["snapshot"],
      async open(ctx, deliver) {
        if (rawPage(ctx).work || ctx.target.kind !== "document")
          return deliver({ kind: "complete", value: null, revision: 0 });
        await readTakeoff("takeoffs.snapshot", takeoffReadScope(page(ctx)), ctx.target.ref);
        if (ctx.signal.aborted) return;
        return subscriptionSource({
          request: () => ({
            kind: "takeoff-reading",
            target: ctx.target.kind === "document" ? ctx.target.ref : { session: "", openId: "" },
          }),
          decode: (value) => takeoffObservationSchema.nullable().parse(value),
        }).open(ctx, deliver);
      },
    },
    "takeoffs.candidates": {
      kind: "use",
      dirties: ["candidates", "snapshot"],
      async open(ctx, deliver) {
        const values = await Promise.all(
          ctx.target.kind === "document" && !rawPage(ctx).work
            ? page(ctx).views.map((view) => callOp(ctx, "takeoffs.candidates", { view }))
            : [],
        );
        const regions = values
          .flatMap((value) => value.regions)
          .map((raw) => {
            const region = raw;
            return { ...region, role: region.role ?? null, guid: region.guid ?? null };
          });
        deliver({
          kind: "complete",
          value: candidateRegionSchema.array().parse(regions),
          revision: 1,
        });
      },
    },
    "takeoffs.ownerCrops": {
      kind: "use",
      dirties: ["candidates", "snapshot"],
      async open(ctx, deliver) {
        const zones =
          worldOf(ctx)?.zones.filter((zone) => zone.zone.lane.label === levelOf(ctx)) ?? [];
        const crops: Record<string, OwnerCrop | null> = {};
        for (const view of [...new Set(zones.map((zone) => zone.zone.lane.view))].sort()) {
          if (ctx.target.kind !== "document" || rawPage(ctx).work) continue;
          const result = await callOp(ctx, "takeoffs.candidates", { view });
          for (const region of result.regions)
            crops[`${view}:${region.elementId}`] = region.ownerCrop ?? null;
        }
        deliver({ kind: "complete", value: crops, revision: 1 });
      },
    },
    "takeoffs.plan": {
      kind: "use",
      dirties: ["snapshot"],
      async open(ctx, deliver) {
        const world = worldOf(ctx);
        const level = levelOf(ctx);
        const crops = ctx.inputs.ownerCrops?.value as Record<string, OwnerCrop | null> | undefined;
        const pick = planView(
          world?.lanes ?? [],
          page(ctx).views,
          level,
          (world?.zones ?? [])
            .filter((zone) => zone.zone.lane.label === level)
            .map((zone) => ({
              view: zone.zone.lane.view,
              name: zone.name,
              ownerCrop: crops
                ? (crops[`${zone.zone.lane.view}:${zone.zone.elementId}`] ?? null)
                : undefined,
            })),
        );
        const image =
          pick.view && ctx.target.kind === "document" && !rawPage(ctx).work
            ? planOf(await callOp(ctx, "revit.context.view-image", { target: { name: pick.view } }))
            : null;
        deliver({ kind: "complete", value: { image, note: pick.note ?? null }, revision: 1 });
      },
    },
    "takeoffs.rhvacVersion": {
      kind: "use",
      dirties: ["rhvac-open"],
      open(ctx, deliver) {
        if (rawPage(ctx).work || !rawPage(ctx).r10)
          return deliver({ kind: "complete", value: null, revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "rhvac-file-version", path: rawPage(ctx).r10 }),
          decode: (value) => rhvacFileVersionSchema.parse(value),
        }).open(ctx, deliver);
      },
    },
    "takeoffs.receipts": subscriptionSource({
      request: () => ({ kind: "receipts" }),
      decode: (value) => z.array(actionReceiptSchema).parse(value),
      dirties: ["receipts", "snapshot"],
    }),
    "takeoffs.captures": subscriptionSource({
      request: () => ({ kind: "takeoff-saved" }),
      decode: (value) => z.array(takeoffCaptureSummarySchema).parse(value),
    }),
    "takeoffs.saved": composeSource({
      key: "takeoffs.observations",
      map: (value) => {
        if (value !== null && !("snapshot" in value))
          throw Error("Expected saved Takeoffs reading");
        return value;
      },
      input: (ctx) => (rawPage(ctx).work ? { query: { capture: rawPage(ctx).work } } : null),
      absent: null,
    }),
    "takeoffs.text": composeSource({
      key: "takeoffs.observations",
      map: (value) => {
        if (value !== null && !("text" in value)) throw Error("Expected saved Takeoffs text");
        return value;
      },
      input: (ctx) =>
        rawPage(ctx).work && rawPage(ctx).fileText
          ? { query: { capture: rawPage(ctx).work, text: "1" } }
          : null,
      absent: null,
    }),
  };
}

export const takeoffQueries = readTable(takeoffReads, (key, input, ctx) =>
  readTakeoff(key, input, ctx.target.kind === "document" ? ctx.target.ref : undefined),
);
