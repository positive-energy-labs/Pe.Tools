/**
 * FIXTURE ADAPTER — the project-a mock world projected into the live `World` vocabulary.
 *
 * Explicitly chosen (`/takeoffs?source=fixture`), never a fallback: it exists so the atlas is
 * exercisable with dense mid-project state and no Revit attached. Everything here is synthetic
 * or replayed project-a data; elementIds are null, so every write path is inert by construction.
 */
import type { SessionSource, TakeoffHost } from "#/takeoff/store";
import type { World, WorldRoom, WorldZone } from "#/takeoff/world";
import { produceTakeoffSnapshot } from "../../../../../packages/mcps/src/shared/takeoff-ops.ts";

import { loadMockWorldGeo, type GeoRoom, type GeoZone } from "./mock-geo";
import { mockWorld, type MockRoom, type MockWorld, type MockZone } from "./mock";

const room = (r: GeoRoom | MockRoom): WorldRoom => ({
  guid: r.guid,
  elementId: null,
  name: r.name,
  type: r.type,
  sqft: r.sqft,
  ceilingFt: r.ceilingFt,
  label: r.label,
  flags: r.flags.filter((f) => !r.decisions.some((d) => d.flag === f)),
  decisions: r.decisions.map((d) => ({ subject: r.guid, ...d })),
  provenance: { ...r.provenance, sourceRoomId: r.guid },
  r10: r.r10 ? { fileIdentity: "fixture", ...r.r10 } : null,
  data: r.data,
  outer: "outer" in r ? r.outer : null,
  holes: "holes" in r ? r.holes : [],
});

const zone = (z: GeoZone | MockZone): WorldZone => ({
  zone: {
    guid: z.zone.guid,
    elementId: null,
    key: z.zone.key,
    ordinal: z.zone.ordinal,
    lane: { view: z.zone.lane.view, label: z.zone.lane.label, replayPath: null },
    color: z.zone.color,
    loops: z.zone.loops,
    declaredSqft: z.zone.declaredSqft,
    bounds: z.zone.bounds,
  },
  stage: z.stage,
  tags: z.tags,
  name: z.name,
  rooms: z.rooms.map(room),
  residues: ("residues" in z ? z.residues : []).map((r) => ({
    id: r.id,
    reason: r.reason,
    rawSqft: r.rawSqft,
    label: r.label,
    outer: r.outer,
    holes: r.holes,
  })),
  heldSqft: z.heldSqft,
  runs: z.runs.map((r) => ({
    runId: r.runId,
    created: r.created,
    rebound: r.rebound,
    held: r.held,
    orphaned: r.orphaned,
    failures: 0,
    declaredSqft: r.declaredSqft,
    roomSqft: r.roomSqft,
    claimedWallSqft: r.claimedWallSqft,
    excludedSqft: r.excludedSqft,
  })),
  driftSqft: z.driftSqft,
});

export const projectFixtureWorld = (fixture: MockWorld): World => ({
  docName: fixture.docName,
  r10Path: fixture.r10Path,
  lanes: [...new Map(fixture.zones.map((z) => [z.zone.lane.view, z.zone.lane])).values()].map(
    (lane) => ({ view: lane.view, label: lane.label, replayPath: null }),
  ),
  zones: fixture.zones.map(zone),
  systems: fixture.systems.map((system) => ({
    guid: system.guid,
    tag: system.tag,
    zoneKeys: system.zoneKeys,
    sensibleBtuh: system.sensibleBtuh,
    overCap: system.overCap,
  })),
});

export const createFixtureTakeoffHost = (): TakeoffHost => ({
  fixture: true,
  readSnapshot(session, document, write) {
    return produceTakeoffSnapshot(async () => {
      const world = projectFixtureWorld(await loadMockWorldGeo().catch(() => mockWorld()));
      return {
        from: {
          target: session.sdkSessionId ?? `pid:${session.processId}`,
          documentId: document.documentId,
          observedAt: new Date().toISOString(),
        },
        world,
        views: world.lanes.map((lane) => ({ name: lane.view, level: lane.label, regions: 0 })),
        zoneFrs: [],
        regionsByZone: {},
      };
    }, write);
  },
  async listRhvac(dir) {
    return [{ path: `${dir}\\projectA.r10`, name: "projectA.r10" }];
  },
  async openRhvac(path) {
    return { path };
  },
  async readCandidates(_session, view) {
    const world = projectFixtureWorld(await loadMockWorldGeo().catch(() => mockWorld()));
    return world.zones
      .filter((zone) => zone.zone.lane.view === view)
      .map((zone, index) => ({
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
        loops: zone.zone.loops.map((loop) => loop.map(([x, y]) => [x, y] as [number, number])),
      }));
  },
  async adopt(_session, input) {
    return { text: `fixture adopted ${input.items.length} zoning regions` };
  },
  async capture() {
    throw new Error("fixture takeoff host is read-only");
  },
  async partition() {
    throw new Error("fixture takeoff host is read-only");
  },
  async writeDecisions() {
    throw new Error("fixture takeoff host is read-only");
  },
  async writeRoomType() {
    throw new Error("fixture takeoff host is read-only");
  },
  async launchRhvac() {
    throw new Error("fixture takeoff host is read-only");
  },
  async syncRhvac() {
    throw new Error("fixture takeoff host is read-only");
  },
});

export const createFixtureSessionSource = (): SessionSource => {
  const session = {
    sessionId: "fixture",
    processId: 0,
    lane: null,
    custody: "observed" as const,
    activeDocumentId: "C:\\Fixtures\\project-a Residence.rvt",
    activeDocumentTitle: "project-a Residence.rvt",
    openDocumentCount: 1,
  };
  return {
    async list() {
      return [session];
    },
    async activeDocument() {
      return { session, documentId: session.activeDocumentId, title: session.activeDocumentTitle };
    },
    subscribe() {
      return () => undefined;
    },
  };
};
