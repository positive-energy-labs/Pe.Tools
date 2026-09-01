import {
  address,
  applyPatches,
  takeoffsRouteState,
  type RouteEnvelope,
  type TakeoffSnapshot,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import type { Scope, Slice } from "#/state/route-store";
import { createTakeoffStore, type SessionSource, type TakeoffHost } from "#/takeoff/store";
import type { World, WorldRoom, WorldZone } from "#/takeoff/world";

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

const projectFixtureWorld = (fixture: MockWorld): World => ({
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

const fallbackWorld = projectFixtureWorld(mockWorld());
let loadedWorld: Promise<World> | undefined;
const fixtureWorld = () =>
  (loadedWorld ??= loadMockWorldGeo()
    .then(projectFixtureWorld)
    .catch(() => fallbackWorld));

const snapshot = (world: World, observedAt: string): TakeoffSnapshot => ({
  reading: {
    at: address("C:\\Fixtures\\project-a Residence.rvt"),
    version: null,
    observedAt,
  },
  carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
  world,
  zoneFrs: [],
  regionsByZone: {},
});

export const createFixtureTakeoffHost = (): TakeoffHost => ({
  fixture: true,
  async readSnapshot(_session, _document, _views, write) {
    const next = snapshot(await fixtureWorld(), new Date().toISOString());
    await write(next);
    return next;
  },
  async readViews() {
    const world = await fixtureWorld();
    return world.lanes.map((lane) => ({
      name: lane.view,
      level: lane.label,
      regions: world.zones.filter((zone) => zone.zone.lane.view === lane.view).length,
    }));
  },
  async listRhvac(dir) {
    return [{ path: `${dir}\\projectA.r10`, name: "projectA.r10" }];
  },
  async openRhvac(path) {
    return { path };
  },
  async readCandidates(_session, view) {
    return (await fixtureWorld()).zones
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
  async initializeCarrier() {
    throw new Error("fixture takeoff host is read-only");
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

export const createFixtureTakeoffStore = (registry: AtomRegistry.AtomRegistry, scope: Scope) => {
  const document = takeoffsRouteState.schema.parse({
    bindings: Object.fromEntries(
      fallbackWorld.lanes.map(({ view }) => [
        `views:${view}`,
        { id: view, label: view, at: scope.documentAddress },
      ]),
    ),
    snapshot: snapshot(fallbackWorld, "2026-08-17T00:00:00.000Z"),
    staged: [],
  });
  let envelope: RouteEnvelope<TakeoffsRouteDocument> = { version: 1, revision: 0, doc: document };
  const value = (): Slice<TakeoffsRouteDocument> => ({
    doc: envelope.doc,
    revision: envelope.revision,
    hydrated: true,
    connected: false,
    error: null,
    peaActive: false,
  });
  const slice = Atom.make(AsyncResult.success(value()));
  const writer = {
    async apply(patches: Parameters<typeof applyPatches>[3]) {
      const landed = applyPatches(
        takeoffsRouteState,
        envelope,
        "human",
        patches,
        envelope.revision,
      );
      if (!landed.ok) return landed;
      envelope = landed.envelope;
      registry.set(slice, AsyncResult.success(value()));
      return { ok: true as const, revision: envelope.revision, doc: envelope.doc };
    },
  };
  return createTakeoffStore({
    host: createFixtureTakeoffHost(),
    sessions: createFixtureSessionSource(),
    source: "fixture",
    registry,
    scope,
    slice,
    writer,
  });
};
