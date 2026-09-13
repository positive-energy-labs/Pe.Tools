/**
 * The Takeoffs route, declared once. Work is the staged-edit route state; Readings are the three
 * subjects the host serves for this route; every action is a `/call` bound to the resolved Target;
 * every seed is PLAIN DATA — the fixture host, the fixture session source and the fixture store
 * that used to stand in for them are deleted (fold 4).
 */
import { z } from "zod";
import {
  address,
  takeoffsRouteState,
  type CandidateRegion,
  type TakeoffModel,
  type TakeoffSnapshot,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";

import { defineRoute, type Ctx as RouteCtx } from "#/route";

type Ctx = RouteCtx<TakeoffsRouteDocument, TakeoffReadingKey, TakeoffPage>;
import type { Seed } from "@pe/agent-contracts";

import { projectFixtureModel } from "./proto/project-model";
import { mockModel } from "./proto/mock";

/** The Page a Takeoffs seed sets: what the route has selected when the seed is mounted. */
export interface TakeoffPage {
  views: readonly string[];
  zones: readonly string[];
  dir: string;
  r10: string;
  stage: "adopt" | "audit" | "sync";
  panel: "sync" | null;
}

export const takeoffPageSchema = z.object({
  views: z.array(z.string()).default([]),
  zones: z.array(z.string()).default([]),
  dir: z.string().default(""),
  r10: z.string().default(""),
  stage: z.enum(["adopt", "audit", "sync"]).default("adopt"),
  panel: z.enum(["sync"]).nullable().default(null),
}) satisfies z.ZodType<TakeoffPage, any, any>;

export type TakeoffReadingKey =
  | "snapshot"
  | "saved"
  | "inventory"
  | "candidates"
  | "receipts";

/* ── Seed data ─────────────────────────────────────────────────────────────── */

const FIXTURE_AT = address("C:\\Fixtures\\project-a Residence.rvt");
const model: TakeoffModel = projectFixtureModel(mockModel());

const snapshotOf = (world: TakeoffModel, observedAt: string): TakeoffSnapshot => ({
  reading: { at: FIXTURE_AT, version: null, observedAt },
  carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
  world,
  zoneFrs: [],
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
  readings: { inventory: [], ...readings },
  page,
  ...(failure ? { failure } : {}),
});

/* ── The manifest ──────────────────────────────────────────────────────────── */

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
    /** The designer-drawn regions of the bound document, read with the model. */
    candidates: { kind: "takeoff-reading", target: { session: "", openId: "" } },
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
      ready: (ctx: Ctx) => (ctx.page.views.length ? null : "Select regions to adopt"),
      run: async (ctx: Ctx) => {
        await ctx.call("takeoffs.adopt", { views: ctx.page.views.map((view: string) => ({ view, items: [] })) });
      },
    },
    partition: {
      label: "partition zones",
      says: "Prepare carriers and partition the selected adopted zone.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["snapshot"],
      ready: (ctx: Ctx) => (ctx.page.zones.length ? null : "Select zones to partition"),
      run: async (ctx: Ctx) => {
        for (const zoneGuid of ctx.page.zones)
          await ctx.call("takeoffs.partition", { zoneGuid, view: "", zoneName: "", zoneRegion: 0 });
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
      dirties: ["snapshot"],
      ready: (ctx: Ctx) => (ctx.page.r10 ? null : "Choose an .r10 file"),
      run: async (ctx: Ctx) => ctx.setPage({ panel: "sync" }),
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
      { snapshot: snapshotOf(model, "2026-08-17T00:00:00.000Z"), saved: [], candidates },
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
      { views: allViews, zones: allZones, stage: "sync", dir: "C:\\Fixtures", r10: "C:\\Fixtures\\projectA.r10" },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:20:00.000Z"), saved: [] },
    ),
    launch: seed(
      "project-a — synced, RHVAC not open",
      { views: allViews, zones: allZones, stage: "sync", dir: "C:\\Fixtures", r10: "C:\\Fixtures\\projectA.r10" },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:30:00.000Z"), saved: [] },
    ),
    "retry-r10": seed(
      "project-a — the .r10 read failed",
      { views: allViews, zones: allZones, stage: "sync", dir: "C:\\Fixtures", r10: "C:\\Fixtures\\projectA.r10" },
      { snapshot: snapshotOf(adopted, "2026-08-17T00:30:00.000Z"), saved: [] },
      { action: "retry-r10", message: "the .r10 file could not be read from the bound folder" },
    ),
  } as never,
});
