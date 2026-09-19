/**
 * Takeoffs action semantics and deterministic seed moments. The route manifest composes these;
 * this file contains no React state or rendering.
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
  type Phase,
  type Reading,
  type TakeoffObservation,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";
import {
  stagedAdoptChoices,
  stagedDecisions,
  stagedTakeoffEdits,
  takeoffDecisionKey,
} from "@pe/agent-contracts";

import { semanticActionFacts, semanticActionInput, type Ctx as RouteCtx } from "#/route/manifest";
import {
  runSemanticAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { applyEdit, readZoneMeta } from "./world";

type Ctx = RouteCtx<TakeoffsRouteDocument, TakeoffReadingKey, TakeoffPage>;
import type { Seed } from "@pe/agent-contracts";

import { projectMockModel } from "./proto/project-model";
import { mockModel } from "./proto/mock";

const syncReviewSchema = z.object({
  target: documentRefSchema,
  work: z.object({ key: workKeySchema, revision: z.number() }),
  captureId: z.string(),
  fileVersion: z.string(),
  path: z.string(),
  zones: z.array(z.string()).readonly(),
});

/**
 * Route-lifetime action scope. `views`/`zones`/`r10`/`stage` select what route actions mean;
 * `stageFilter` filters the current view. Target changes reset them. `panel` and `syncReview` are
 * short-lived review state and every scope transition invalidates them. Standalone room navigation
 * lives in its URL, embedded navigation in its controller, and authored decisions in Work.
 */
export interface TakeoffPage {
  views: readonly string[];
  zones: readonly string[];
  r10: string;
  stage: "adopt" | "audit" | "sync";
  stageFilter: Phase | null;
  panel: "sync" | null;
  syncReview: z.infer<typeof syncReviewSchema> | null;
}

export const takeoffPageSchema = z.object({
  views: z.array(z.string()).readonly().default([]),
  zones: z.array(z.string()).readonly().default([]),
  r10: z.string().default(""),
  stage: z.enum(["adopt", "audit", "sync"]).default("adopt"),
  stageFilter: z
    .enum(["declared", "registered", "partitioned", "reviewed", "data", "synced", "drifted"])
    .nullable()
    .default(null),
  panel: z.enum(["sync"]).nullable().default(null),
  syncReview: syncReviewSchema.nullable().default(null),
}) satisfies z.ZodType<TakeoffPage, any, any>;

export type TakeoffReadingKey = "snapshot" | "rhvacVersion" | "inventory" | "receipts";

const rhvacVersionSchema = z.object({
  path: z.string().min(1),
  fileVersion: z.string().min(1),
});

/* ── Seed data ─────────────────────────────────────────────────────────────── */

const FIXTURE_AT = address("C:\\Fixtures\\project-a Residence.rvt");
const DEMO_TARGET = { kind: "document", ref: { session: "demo", openId: "demo" } } as const;
const DEMO_INVENTORY = {
  sessions: [
    {
      sessionId: "demo",
      connected: true,
      openDocumentCount: 1,
      openDocuments: [
        {
          openId: "demo",
          title: "project-a Residence.rvt (seed)",
          address: FIXTURE_AT,
          isFamilyDocument: false,
          isActive: true,
        },
      ],
    },
  ],
} as const;
const model: TakeoffModel = projectMockModel(mockModel());

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

const emptyWork: TakeoffsRouteDocument = takeoffsRouteState.schema.parse({});

const allViews = model.lanes.map((lane) => lane.view);
const allZones = model.zones.map((zone) => zone.zone.guid);

const seed = (
  title: string,
  page: Partial<TakeoffPage>,
  readings: Partial<Record<TakeoffReadingKey, unknown>>,
  failure?: { action: string; message: string },
): Seed<TakeoffsRouteDocument, TakeoffReadingKey, TakeoffPage> => ({
  title,
  target: DEMO_TARGET,
  work: emptyWork,
  readings: {
    inventory: DEMO_INVENTORY,
    ...readings,
    ...(readings.snapshot
      ? {
          snapshot: {
            kind: "ready",
            target: DEMO_TARGET.ref,
            capture: {
              id: "0".repeat(64),
              capturedAt: (readings.snapshot as TakeoffSnapshot).reading.observedAt,
              provenance: { kind: "live", target: DEMO_TARGET.ref },
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
export const takeoffHealth = (snapshot: TakeoffSnapshot | undefined): string | null =>
  snapshot?.carriers.status === "needs-initialization"
    ? `needs initialization · ${snapshot.carriers.missingCarrierGuids.length} carriers`
    : null;
export const takeoffReadingHealth = (reading: Reading<TakeoffSnapshot>): string | null =>
  reading.state === "failed"
    ? reading.message
    : reading.state === "ready"
      ? takeoffHealth(reading.observation)
      : null;
const adoption = (ctx: Ctx) => {
  const grouped = new Map<string, { elementId: number; name: string; systemTag: string }[]>();
  for (const region of currentSnapshot(ctx)?.zoneFrs ?? []) {
    if (!ctx.page.views.includes(region.view)) continue;
    const patch = ctx.work.doc
      ? stagedAdoptChoices(ctx.work.doc)[`${region.view}:${region.elementId}`]
      : undefined;
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
const dispatch = async (
  ctx: Ctx,
  key: "takeoffs.initialize" | "takeoffs.adopt" | "takeoffs.partition",
  input: Record<string, unknown>,
) => {
  if (ctx.target.kind !== "document") throw Error("An open document is required");
  actionResult(await runSemanticAction(key, semanticActionInput(key, input), ctx.target.ref));
};

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
  decisions: Readonly<Record<string, "accept" | "dismiss">> = {},
): SyncPlan {
  const selected = new Set(selectedZones);
  const inScope = world.zones
    .filter((zone) => selected.size === 0 || selected.has(zone.zone.guid))
    .map((zone) => ({
      ...zone,
      rooms: zone.rooms.map((room) => applyEdit(room, staged[room.guid]?.next)),
    }));
  const blockedZones = inScope.filter(
    (zone) =>
      zone.driftSqft === null ||
      zone.driftSqft > 0 ||
      zone.rooms.some(
        (room) => room.analysis?.state !== "current" || room.analysis.hold !== null,
      ) ||
      zone.rooms.some((room) =>
        room.flags.some((flag) => decisions[takeoffDecisionKey(room.guid, flag)] === undefined),
      ) ||
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
  const fileVersion =
    ctx.readings.rhvacVersion.state === "ready"
      ? rhvacVersionSchema.safeParse(ctx.readings.rhvacVersion.observation).data
      : undefined;
  if (
    ctx.target.kind !== "document" ||
    ctx.target.ref.session !== review.target.session ||
    ctx.target.ref.openId !== review.target.openId ||
    workKey(ctx.work.key) !== workKey(review.work.key) ||
    !ctx.work.doc ||
    ctx.work.revision !== review.work.revision ||
    observation?.kind !== "ready" ||
    observation.capture.id !== review.captureId ||
    fileVersion?.path !== review.path ||
    fileVersion?.fileVersion !== review.fileVersion ||
    ctx.page.r10 !== review.path ||
    JSON.stringify(ctx.page.zones) !== JSON.stringify(review.zones)
  )
    return "The reviewed scope or data changed; review sync again";
  const plan = syncPlan(
    observation.capture.snapshot.world,
    review.zones,
    stagedTakeoffEdits(ctx.work.doc),
    stagedDecisions(ctx.work.doc),
  );
  // The host's words: a flag with only Pea's proposed verdict is undecided, so its zone blocks.
  if (plan.blockedZones.length)
    return `${plan.blockedZones.length} selected zones are not ready to sync`;
  if (plan.untagged) return "Tag the eligible zones before syncing";
  if (!plan.inserts.length && !plan.linkedUpdates)
    return "No eligible inserts or linked staged updates";
  return null;
};

export const takeoffActions = {
  initialize: {
    label: "initialize",
    ...semanticActionFacts("takeoffs.initialize"),
    input: z.void(),
    dirties: ["snapshot"],
    requires: { readings: ["snapshot"] },
    count: (ctx: Ctx) => {
      const carriers = currentSnapshot(ctx)?.carriers;
      return carriers?.status === "needs-initialization"
        ? carriers.missingCarrierGuids.length
        : null;
    },
    ready: (ctx: Ctx) => {
      const snapshot = currentSnapshot(ctx);
      if (!snapshot) return "Read the document first";
      return takeoffHealth(snapshot) ? null : "The document already carries every shared parameter";
    },
    run: async (ctx: Ctx) => {
      await dispatch(ctx, "takeoffs.initialize", { stage: currentSnapshot(ctx)!.carriers.stage });
    },
  },
  adopt: {
    label: "adopt",
    ...semanticActionFacts("takeoffs.adopt"),
    input: z.void(),
    dirties: ["snapshot"],
    requires: { work: true, readings: ["snapshot"] },
    chord: "mod+shift+a",
    stage: "adopt",
    count: (ctx: Ctx) => adoption(ctx).reduce((sum, view) => sum + view.items.length, 0) || null,
    ready: (ctx: Ctx) => (adoption(ctx).length ? null : "Select regions to adopt"),
    run: async (ctx: Ctx) => {
      await dispatch(ctx, "takeoffs.adopt", { views: adoption(ctx) });
    },
  },
  partition: {
    label: "partition",
    ...semanticActionFacts("takeoffs.partition"),
    input: z.void(),
    dirties: ["snapshot"],
    requires: { readings: ["snapshot"] },
    stage: "audit",
    count: (ctx: Ctx) => ctx.page.zones.length || null,
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
        const zone = currentSnapshot(ctx)!.world.zones.find((item) => item.zone.guid === zoneGuid)!;
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
    // Every stage reads; refresh belongs to none of them.
    ready: () => null,
    run: async (ctx: Ctx) => {
      await ctx.call("takeoffs.snapshot", {});
    },
  },
  sync: {
    label: "review sync",
    says: "Review the room changes before syncing them into RHVAC.",
    needs: "project",
    actor: "human",
    input: z.void(),
    dirties: [],
    requires: { work: true, readings: ["snapshot", "rhvacVersion"] },
    stage: "sync",
    count: (ctx: Ctx) => ctx.page.zones.length || null,
    ready: (ctx: Ctx) => (ctx.page.r10 ? null : "Choose an .r10 file"),
    run: async (ctx: Ctx) => {
      ctx.setPage({ syncReview: null });
      const observation =
        ctx.readings.snapshot.state === "ready"
          ? (ctx.readings.snapshot.observation as TakeoffObservation)
          : null;
      if (ctx.target.kind !== "document" || observation?.kind !== "ready" || !ctx.work.doc)
        throw Error("A current document capture and authored Work are required for review");
      const version = rhvacVersionSchema.parse(
        ctx.readings.rhvacVersion.state === "ready" ? ctx.readings.rhvacVersion.observation : null,
      );
      if (version.path !== ctx.page.r10)
        throw Error("The RHVAC file selection changed during review");
      const review = {
        target: ctx.target.ref,
        work: { key: ctx.work.key, revision: ctx.work.revision! },
        captureId: observation.capture.id,
        fileVersion: version.fileVersion,
        path: version.path,
        zones: ctx.page.zones,
      };
      ctx.setPage({ panel: "sync", syncReview: review });
    },
  },
  "commit-sync": {
    label: "sync",
    ...semanticActionFacts("takeoffs.sync"),
    input: z.void(),
    dirties: ["snapshot", "rhvacVersion", "receipts"],
    requires: { work: true, readings: ["snapshot", "rhvacVersion"] },
    stage: "sync",
    count: (ctx: Ctx) => ctx.page.syncReview?.zones.length ?? null,
    ready: syncRefusal,
    run: async (ctx: Ctx) => {
      const review = ctx.page.syncReview!;
      actionResult(
        await runSemanticAction(
          "takeoffs.sync",
          semanticActionInput("takeoffs.sync", { path: review.path, zones: review.zones }),
          review.target,
          { captureId: review.captureId, fileVersion: review.fileVersion, work: review.work },
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
    stage: "sync",
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
    dirties: ["rhvacVersion"],
    stage: "sync",
    ready: (ctx: Ctx) => (ctx.page.r10 ? null : "Choose an .r10 file"),
    run: async (ctx: Ctx) => {
      await ctx.call("rhvac.open", { path: ctx.page.r10 });
    },
  },
} as const;

export const takeoffSeeds = {
  adopt: seed(
    "project-a — regions drawn, nothing adopted",
    { views: allViews, zones: [], stage: "adopt" },
    { snapshot: snapshotOf(model, "2026-08-17T00:00:00.000Z") },
  ),
  partition: seed(
    "project-a — zones adopted, ready to partition",
    { views: allViews, zones: allZones, stage: "audit" },
    { snapshot: snapshotOf(adopted, "2026-08-17T00:10:00.000Z") },
  ),
  refresh: seed(
    "project-a — a stale model waiting for a re-read",
    { views: allViews, zones: allZones, stage: "audit" },
    { snapshot: snapshotOf(model, "2026-08-01T00:00:00.000Z") },
  ),
  sync: seed(
    "project-a — partitioned, .r10 bound, sync unreviewed",
    {
      views: allViews,
      zones: allZones,
      stage: "sync",
      r10: "C:\\Fixtures\\projectA.r10",
    },
    {
      snapshot: snapshotOf(adopted, "2026-08-17T00:20:00.000Z"),
      rhvacVersion: { path: "C:\\Fixtures\\projectA.r10", fileVersion: "seed-version" },
    },
  ),
  launch: seed(
    "project-a — synced, RHVAC not open",
    {
      views: allViews,
      zones: allZones,
      stage: "sync",
      r10: "C:\\Fixtures\\projectA.r10",
    },
    { snapshot: snapshotOf(adopted, "2026-08-17T00:30:00.000Z") },
  ),
  "retry-r10": seed(
    "project-a — the .r10 read failed",
    {
      views: allViews,
      zones: allZones,
      stage: "sync",
      r10: "C:\\Fixtures\\projectA.r10",
    },
    { snapshot: snapshotOf(adopted, "2026-08-17T00:30:00.000Z") },
    { action: "retry-r10", message: "the .r10 file could not be read from the bound folder" },
  ),
} as const;
