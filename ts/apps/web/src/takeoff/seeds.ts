import {
  address,
  takeoffsRouteState,
  type TakeoffModel,
  type TakeoffSnapshot,
  type CandidateRegion,
  type TakeoffsRouteDocument,
  type Seed,
} from "@pe/agent-contracts";
import type { TakeoffPage, TakeoffReadingKey } from "./actions";
import { projectMockModel } from "./proto/project-model";
import { mockModel } from "./proto/mock";

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
  zoneFrs: DEMO_CANDIDATES,
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

/** The demo lane's `takeoffs.candidates` answer: the seed's drawn regions. */
export const DEMO_CANDIDATES: CandidateRegion[] = model.zones.map((zone, index) => ({
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
