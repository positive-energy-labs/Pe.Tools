/**
 * The Takeoffs route, declared once. Work is the staged-edit route state; Readings are the three
 * subjects the host serves for this route; every action is a `/call` bound to the resolved Target;
 * every seed is PLAIN DATA — the fixture host, the fixture session source and the fixture store
 * that used to stand in for them are deleted (fold 4).
 */
import { z } from "zod";
import {
  address,
  documentRefSchema,
  workKeySchema,
  workKey,
  takeoffsRouteState,
  type CandidateRegion,
  type TakeoffModel,
  type TakeoffSnapshot,
  type StagedRoomEdit,
  type ModelRoom,
  type ModelZone,
  type TakeoffObservation,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";

import { defineRoute, type Ctx as RouteCtx } from "#/route";
import {
  runSemanticAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { readZoneMeta } from "./world";

type Ctx = RouteCtx<TakeoffsRouteDocument, TakeoffReadingKey, TakeoffPage>;
import type { Seed } from "@pe/agent-contracts";

import { projectFixtureModel } from "./proto/project-model";
import { mockModel } from "./proto/mock";

const syncReviewSchema = z.object({
  target: documentRefSchema,
  work: z.object({ key: workKeySchema, revision: z.number() }),
  captureId: z.string(),
  fileVersion: z.string(),
  path: z.string(),
  zones: z.array(z.string()).readonly(),
});

/** The Page a Takeoffs seed sets: what the route has selected when the seed is mounted. */
export interface TakeoffPage {
  views: readonly string[];
  zones: readonly string[];
  dir: string;
  r10: string;
  stage: "adopt" | "audit" | "sync";
  panel: "sync" | null;
  syncReview: z.infer<typeof syncReviewSchema> | null;
}

export const takeoffPageSchema = z.object({
  views: z.array(z.string()).readonly().default([]),
  zones: z.array(z.string()).readonly().default([]),
  dir: z.string().default(""),
  r10: z.string().default(""),
  stage: z.enum(["adopt", "audit", "sync"]).default("adopt"),
  panel: z.enum(["sync"]).nullable().default(null),
  syncReview: syncReviewSchema.nullable().default(null),
}) satisfies z.ZodType<TakeoffPage, any, any>;

export type TakeoffReadingKey = "snapshot" | "saved" | "inventory" | "receipts";

/* ── Seed data ─────────────────────────────────────────────────────────────── */

const FIXTURE_AT = address("C:\\Fixtures\\project-a Residence.rvt");
const model: TakeoffModel = projectFixtureModel(mockModel());

const snapshotOf = (world: TakeoffModel, observedAt: string): TakeoffSnapshot => ({
  reading: { at: FIXTURE_AT, version: null, observedAt },
  carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
  world,
  zoneFrs: candidates,
  regionsByZone: {},
});

/** Declared simulation outcome. This is seed data, not an adoption engine. */
const adopted = ((): TakeoffModel => {
  const next = structuredClone(model);
  next.zones.forEach((zone, index) => {
    zone.zone.elementId = index + 101;
  });
  return next;
})();

const candidates: CandidateRegion[] = model.zones.map((zone, index) => ({
  elementId: index + 1,
  typeName: zone.name,
  view: zone.zone.lane.view,
  color: zone.zone.color,
  sqft: zone.zone.declaredSqft,
  role: "zoning-region",
  guid: zone.zone.guid,
  blob: JSON.stringify({
    view: zone.zone.lane.view,
    name: zone.name,
    systemTag: zone.tags[0] ?? "",
  }),
  loops: zone.zone.loops.map((loop) => loop.map(([x, y]): [number, number] => [x, y])),
}));

const emptyWork: TakeoffsRouteDocument = takeoffsRouteState.schema.parse({ staged: [] });

const allViews = model.lanes.map((lane) => lane.view);
const allZones = model.zones.map((zone) => zone.zone.guid);

const seed = (
  title: string,
  page: Partial<TakeoffPage>,
  readings: Partial<Record<TakeoffReadingKey, unknown>>,
  failure?: { action: string; message: string },
): Seed<TakeoffsRouteDocument, TakeoffReadingKey, TakeoffPage> => ({
  title,
  work: emptyWork,
  readings: {
    inventory: [],
    ...readings,
    ...(readings.snapshot
      ? {
          snapshot: {
            kind: "ready",
            target: { session: "fixture", openId: "fixture" },
            capture: {
              id: "0".repeat(64),
              capturedAt: (readings.snapshot as TakeoffSnapshot).reading.observedAt,
              provenance: { kind: "live", target: { session: "fixture", openId: "fixture" } },
              snapshot: readings.snapshot,
            },
          },
        }
      : {}),
  },
  page,
  ...(failure ? { failure } : {}),
});

/* ── The manifest ──────────────────────────────────────────────────────────── */

export const snapshotOfObservation = (
  observation: TakeoffObservation | undefined,
): TakeoffSnapshot | undefined =>
  observation?.kind === "ready"
    ? observation.capture.snapshot
    : observation?.kind === "reading" || observation?.kind === "failed"
      ? observation.previous?.snapshot
      : undefined;
const currentSnapshot = (ctx: Ctx) => {
  if (ctx.readings.snapshot.state !== "ready") return null;
  const observation = ctx.readings.snapshot.observation as TakeoffObservation;
  return observation.kind === "ready" ? observation.capture.snapshot : null;
};
const adoption = (ctx: Ctx) => {
  const grouped = new Map<string, { elementId: number; name: string; systemTag: string }[]>();
  for (const region of currentSnapshot(ctx)?.zoneFrs ?? []) {
    if (!ctx.page.views.includes(region.view)) continue;
    const patch = ctx.work.doc?.adoptPatches[`${region.view}:${region.elementId}`];
    if (!(patch?.checked ?? region.role === "zoning-region")) continue;
    const meta = region.role === "zoning-region" ? readZoneMeta(region.blob) : null;
    const items = grouped.get(region.view) ?? [];
    items.push({
      elementId: region.elementId,
      name:
        patch?.name ?? (meta?.name || region.typeName || `${region.view} ? ${region.elementId}`),
      systemTag: patch?.systemTag ?? meta?.systemTag ?? "",
    });
    grouped.set(region.view, items);
  }
  return [...grouped].map(([view, items]) => ({ view, items }));
};
const dispatch = (
  ctx: Ctx,
  key: "takeoffs.adopt" | "takeoffs.partition",
  input: Record<string, unknown>,
) =>
  ctx.external(async () => {
    if (ctx.target.kind !== "document") throw Error("An open document is required");
    actionResult(await runSemanticAction(key, input, ctx.target.ref));
  });

export interface SyncPlan {
  readonly linkedUpdates: number;
  readonly inScope: readonly ModelZone[];
  readonly blockedZones: readonly ModelZone[];
  readonly inserts: readonly { readonly zone: ModelZone; readonly room: ModelRoom }[];
  readonly untagged: number;
  readonly tags: readonly string[];
}

export function syncPlan(
  world: TakeoffModel,
  selectedZones: readonly string[],
  staged: Readonly<Record<string, StagedRoomEdit>> = {},
): SyncPlan {
  const selected = new Set(selectedZones);
  const inScope = world.zones.filter((zone) => selected.size === 0 || selected.has(zone.zone.guid));
  const blockedZones = inScope.filter(
    (zone) =>
      zone.driftSqft === null ||
      zone.driftSqft > 0 ||
      zone.rooms.some(
        (room) => room.analysis?.state !== "current" || room.analysis.hold !== null,
      ) ||
      zone.rooms.some((room) => room.flags.length > 0) ||
      zone.runs.some((run) => run.orphaned > 0 || run.failures > 0),
  );
  const blocked = new Set(blockedZones.map((zone) => zone.zone.guid));
  const inserts = inScope.flatMap((zone) =>
    blocked.has(zone.zone.guid)
      ? []
      : zone.rooms
          .filter((room) => room.elementId !== null && room.r10 === null && room.data !== null)
          .map((room) => ({ zone, room })),
  );
  return {
    inScope,
    linkedUpdates: inScope
      .flatMap((zone) => zone.rooms)
      .filter((room) => room.r10 && staged[room.guid]).length,
    blockedZones,
    inserts,
    untagged: inserts.filter(({ zone }) => zone.tags.length === 0).length,
    tags: [...new Set(inserts.flatMap(({ zone }) => zone.tags))],
  };
}

const syncRefusal = (ctx: Ctx): string | null => {
  const review = ctx.page.syncReview;
  if (!review) return "Review sync before committing";
  const observation =
    ctx.readings.snapshot.state === "ready"
      ? (ctx.readings.snapshot.observation as TakeoffObservation)
      : null;
  if (
    ctx.target.kind !== "document" ||
    ctx.target.ref.session !== review.target.session ||
    ctx.target.ref.openId !== review.target.openId ||
    workKey(ctx.work.key) !== workKey(review.work.key) ||
    ctx.work.revision !== review.work.revision ||
    observation?.kind !== "ready" ||
    observation.capture.id !== review.captureId ||
    ctx.page.r10 !== review.path ||
    JSON.stringify(ctx.page.zones) !== JSON.stringify(review.zones)
  )
    return "The reviewed scope or data changed; review sync again";
  const plan = syncPlan(
    observation.capture.snapshot.world,
    review.zones,
    Object.fromEntries(ctx.work.doc.staged.map((edit) => [edit.roomId, edit])),
  );
  if (plan.blockedZones.length) return "Resolve the blocked zones before syncing this scope";
  if (plan.untagged) return "Tag the eligible zones before syncing";
  if (!plan.inserts.length && !plan.linkedUpdates)
    return "No eligible inserts or linked staged updates";
  return null;
};

export const manifest = defineRoute({
  key: "takeoffs",
  name: "Takeoffs",
  needs: "project",
  work: takeoffsRouteState,
  readings: {
    /** The model reading for the bound document. The Target is resolved by the owner. */
    snapshot: { kind: "takeoff-reading", target: { session: "", openId: "" } },
    /** Every dated capture of the bound document; the saved-review lane reads only this. */
    saved: { kind: "takeoff-saved", document: FIXTURE_AT },
    inventory: { kind: "inventory" },
    /** Every action receipt for the bound document; the activity disclosure reads only this. */
    receipts: { kind: "receipts" },
  } as never,
  page: takeoffPageSchema,
  actions: {
    adopt: {
      label: "adopt zones",
      says: "Adopt selected regions using the submitted names and system tags.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["snapshot"],
      chord: "mod+shift+a",
      ready: (ctx: Ctx) => (adoption(ctx).length ? null : "Select regions to adopt"),
      run: async (ctx: Ctx) => {
        await dispatch(ctx, "takeoffs.adopt", { views: adoption(ctx) });
      },
    },
    partition: {
      label: "partition zones",
      says: "Prepare carriers and partition the selected adopted zone.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["snapshot"],
      ready: (ctx: Ctx) =>
        !ctx.page.zones.length
          ? "Select zones to partition"
          : ctx.page.zones.every((id) =>
                currentSnapshot(ctx)?.world.zones.some(
                  (zone) => zone.zone.guid === id && zone.zone.elementId !== null,
                ),
              )
            ? null
            : "Refresh the selected adopted zones",
      run: async (ctx: Ctx) => {
        for (const zoneGuid of ctx.page.zones) {
          const zone = currentSnapshot(ctx)!.world.zones.find(
            (item) => item.zone.guid === zoneGuid,
          )!;
          await dispatch(ctx, "takeoffs.partition", {
            zoneGuid,
            view: zone.zone.lane.view,
            zoneName: zone.name,
            zoneRegion: zone.zone.elementId,
          });
        }
      },
    },
    refresh: {
      label: "refresh",
      says: "Read the selected document again.",
      needs: "document",
      actor: "any",
      input: z.void(),
      dirties: ["snapshot"],
      chord: "mod+r",
      ready: () => null,
      run: async (ctx: Ctx) => {
        await ctx.call("takeoffs.read", {});
      },
    },
    sync: {
      label: "review sync .r10",
      says: "Review the room changes before syncing them into RHVAC.",
      needs: "project",
      actor: "human",
      input: z.void(),
      dirties: [],
      ready: (ctx: Ctx) => (ctx.page.r10 ? null : "Choose an .r10 file"),
      run: async (ctx: Ctx) => {
        ctx.setPage({ syncReview: null });
        const review = await ctx.external(async () => {
          const observation =
            ctx.readings.snapshot.state === "ready"
              ? (ctx.readings.snapshot.observation as TakeoffObservation)
              : null;
          if (ctx.target.kind !== "document" || observation?.kind !== "ready" || !ctx.work.doc)
            throw Error("A current document capture and authored Work are required for review");
          const response = await fetch(`/actions?file=${encodeURIComponent(ctx.page.r10)}`);
          if (!response.ok) throw Error("Could not read the RHVAC file version for review");
          const { fileVersion } = z
            .object({ fileVersion: z.string().min(1) })
            .parse(await response.json());
          return {
            target: ctx.target.ref,
            work: { key: ctx.work.key, revision: ctx.work.revision },
            captureId: observation.capture.id,
            fileVersion,
            path: ctx.page.r10,
            zones: ctx.page.zones,
          };
        });
        ctx.setPage({ panel: "sync", syncReview: review });
      },
    },
    "commit-sync": {
      label: "sync reviewed rooms",
      says: "Sync the reviewed room changes using the exact capture, Work and file versions.",
      needs: "project",
      actor: "human",
      input: z.void(),
      dirties: ["snapshot", "receipts"],
      ready: syncRefusal,
      run: async (ctx: Ctx) => {
        const review = ctx.page.syncReview!;
        await ctx.external(async () =>
          actionResult(
            await runSemanticAction(
              "takeoffs.sync",
              { path: review.path, zones: review.zones },
              review.target,
              { captureId: review.captureId, fileVersion: review.fileVersion, work: review.work },
            ),
          ),
        );
        ctx.setPage({ panel: null, syncReview: null });
      },
    },
    launch: {
      label: "open in RHVAC",
      says: "Open the bound .r10 file in RHVAC.",
      needs: "host",
      actor: "human",
      input: z.void(),
      dirties: [],
      ready: (ctx: Ctx) => (ctx.page.r10 ? null : "Choose an .r10 file"),
      run: async (ctx: Ctx) => {
        await ctx.call("rhvac.launch", { path: ctx.page.r10 });
      },
    },
    "retry-r10": {
      label: "retry .r10",
      says: "Read the bound .r10 file again after a failed read.",
      needs: "host",
      actor: "any",
      input: z.void(),
      dirties: [],
      ready: (ctx: Ctx) => (ctx.page.r10 ? null : "Choose an .r10 file"),
      run: async (ctx: Ctx) => {
        await ctx.call("rhvac.open", { path: ctx.page.r10 });
      },
    },
  } as never,
  seeds: {
    adopt: seed(
      "project-a — regions drawn, nothing adopted",
      { views: allViews, zones: [], stage: "adopt" },
      { snapshot: snapshotOf(model, "2026-08-17T00:00:00.000Z"), saved: [] },
    ),
    partition: seed(
      "project-a — zones adopted, ready to partition",
      { views: allViews, zones: allZones, stage: "audit" },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:10:00.000Z"), saved: [] },
    ),
    refresh: seed(
      "project-a — a stale model waiting for a re-read",
      { views: allViews, zones: allZones, stage: "audit" },
      { snapshot: snapshotOf(model, "2026-08-01T00:00:00.000Z"), saved: [] },
    ),
    sync: seed(
      "project-a — partitioned, .r10 bound, sync unreviewed",
      {
        views: allViews,
        zones: allZones,
        stage: "sync",
        dir: "C:\\Fixtures",
        r10: "C:\\Fixtures\\projectA.r10",
      },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:20:00.000Z"), saved: [] },
    ),
    launch: seed(
      "project-a — synced, RHVAC not open",
      {
        views: allViews,
        zones: allZones,
        stage: "sync",
        dir: "C:\\Fixtures",
        r10: "C:\\Fixtures\\projectA.r10",
      },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:30:00.000Z"), saved: [] },
    ),
    "retry-r10": seed(
      "project-a — the .r10 read failed",
      {
        views: allViews,
        zones: allZones,
        stage: "sync",
        dir: "C:\\Fixtures",
        r10: "C:\\Fixtures\\projectA.r10",
      },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:30:00.000Z"), saved: [] },
      { action: "retry-r10", message: "the .r10 file could not be read from the bound folder" },
    ),
  } as never,
});
