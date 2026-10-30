import { readTable } from "../../../../packages/mcps/src/shared/query-client";
import { takeoffReads, readTakeoff } from "./queries";
import { z } from "zod";
import {
  actionReceiptSchema,
  candidateRegionSchema,
  takeoffCaptureSchema,
  takeoffCaptureSummarySchema,
  takeoffObservationSchema,
  type TakeoffCapture,
  type TakeoffObservation,
  type TakeoffModel,
} from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import type { RevitContextViewImage } from "@pe/host-contracts/generated";
import { jsonSource, requestJson, type JsonRequest } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource } from "#/shell/readings";
import type { TakeoffGraphPage } from "./graph";
import { snapshotOfObservation } from "./actions";
import { planOf, planView, type OwnerCrop } from "./plan";

const page = (ctx: ReadingContext) => ctx.page as TakeoffGraphPage;
const worldOf = (ctx: ReadingContext): TakeoffModel | undefined =>
  page(ctx).work
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
function rpc(ctx: ReadingContext, key: string, request: unknown): JsonRequest | null {
  return ctx.target.kind !== "document" || page(ctx).work
    ? null
    : {
        path: "/call",
        body: { key, request },
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: ctx.target.ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: ctx.target.ref.openId,
        },
      };
}
export function takeoffSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "takeoffs.snapshot": {
      kind: "use",
      dirties: ["snapshot"],
      open(ctx, deliver) {
        if (page(ctx).work || ctx.target.kind !== "document")
          return deliver({ kind: "complete", value: null, revision: 0 });
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
        const requests = page(ctx).views.flatMap((view) => {
          const request = rpc(ctx, "takeoffs.candidates", { view });
          return request ? [request] : [];
        });
        const values = await Promise.all(
          requests.map((request) =>
            requestJson(request, z.object({ regions: z.array(z.unknown()) }), ctx.signal),
          ),
        );
        const regions = values
          .flatMap((value) => value.regions)
          .map((raw) => {
            const region = raw as Record<string, unknown>;
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
          const request = rpc(ctx, "takeoffs.candidates", { view });
          if (!request) continue;
          const result = await requestJson(
            request,
            z.object({
              regions: z.array(
                z.object({
                  elementId: z.number(),
                  ownerCrop: z.enum(["Inside", "Crossing", "Outside"]).nullish(),
                }),
              ),
            }),
            ctx.signal,
          );
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
        const request = pick.view
          ? rpc(ctx, "revit.context.view-image", { target: { name: pick.view } })
          : null;
        const image = request
          ? planOf(
              await requestJson(
                request,
                z.custom<RevitContextViewImage.Res.Response>(),
                ctx.signal,
              ),
            )
          : null;
        deliver({ kind: "complete", value: { image, note: pick.note ?? null }, revision: 1 });
      },
    },
    "takeoffs.rhvacVersion": {
      kind: "use",
      dirties: ["rhvac-open"],
      open(ctx, deliver) {
        if (page(ctx).work || !page(ctx).r10)
          return deliver({ kind: "complete", value: null, revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "rhvac-file-version", path: page(ctx).r10 }),
          decode: (value) => z.object({ path: z.string(), fileVersion: z.string() }).parse(value),
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
    "takeoffs.saved": jsonSource({
      request: (ctx) =>
        page(ctx).work
          ? { path: `/takeoffs/observations?capture=${encodeURIComponent(page(ctx).work)}` }
          : null,
      schema: takeoffCaptureSchema.nullable(),
      absent: null,
    }),
    "takeoffs.text": jsonSource({
      request: (ctx) =>
        page(ctx).work && page(ctx).fileText
          ? { path: `/takeoffs/observations?capture=${encodeURIComponent(page(ctx).work)}&text=1` }
          : null,
      schema: z.object({ path: z.string(), text: z.string() }).nullable(),
      absent: null,
    }),
  };
}

export const takeoffQueries = readTable(takeoffReads, (key, input, ctx) =>
  readTakeoff(key, input, ctx.target.kind === "document" ? ctx.target.ref : undefined),
);
