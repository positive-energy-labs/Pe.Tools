import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  takeoffsRouteState,
  type RouteStatePatch,
  type TakeoffSnapshot,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";
import type { Slice } from "#/state/route-store";

import {
  createFixtureTakeoffStore,
  createFixtureTakeoffHost,
  createFixtureSessionSource,
} from "#/takeoff/proto/fixture-world";
import {
  createTakeoffStore,
  EMPTY_TAKEOFF_SELECTION,
  type SessionEvent,
  type SessionSource,
  type TakeoffHost,
  type TakeoffSelection,
} from "#/takeoff/store";

const bound: TakeoffSelection = {
  ...EMPTY_TAKEOFF_SELECTION,
  views: ["Mechanical Zoning Plan - Main Level"],
  zones: ["zone-1"],
  dir: "C:\\Takeoffs",
  r10: "C:\\Takeoffs\\projectA.r10",
  stage: "audit",
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
  vi.restoreAllMocks();
});

type StoreDeps = Parameters<typeof createTakeoffStore>[0];
const createStore = (
  deps: Omit<StoreDeps, "registry" | "scope" | "slice" | "writer"> &
    Partial<Pick<StoreDeps, "registry" | "scope" | "slice" | "writer">>,
  observe?: (patches: RouteStatePatch[]) => void,
) => {
  const registry = deps.registry ?? AtomRegistry.make({ defaultIdleTTL: 400 });
  registries.push(registry);
  const initial: TakeoffsRouteDocument = {
    bindings: {},
    snapshot: null,
    staged: [],
  };
  const slice =
    deps.slice ??
    Atom.make(
      AsyncResult.success({
        doc: initial,
        revision: 0,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
  let publishedSlice = slice;
  const publish = (document: TakeoffsRouteDocument) =>
    registry.set(
      publishedSlice as Atom.Writable<AsyncResult.AsyncResult<Slice<TakeoffsRouteDocument>, Error>>,
      AsyncResult.success({
        doc: document,
        revision: 0,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
  const writer = deps.writer ?? {
    async apply(patches: RouteStatePatch[]) {
      observe?.(patches);
      const current = registry.get(publishedSlice);
      if (!AsyncResult.isSuccess(current) || !current.value.doc)
        return { ok: false as const, kind: "error" as const, error: "not hydrated", hint: "" };
      const document = structuredClone(current.value.doc);
      for (const patch of patches) {
        if (patch.path[0] === "bindings")
          document.bindings[String(patch.path[1])] = patch.value as never;
        if (patch.path[0] === "snapshot")
          document.snapshot = (patch.value ?? null) as TakeoffsRouteDocument["snapshot"];
        if (patch.path[0] === "staged")
          document.staged = patch.value as TakeoffsRouteDocument["staged"];
      }
      publish(document);
      return { ok: true as const, revision: 1 };
    },
    async command() {
      return { ok: true as const, revision: 1 };
    },
  };
  const store = createTakeoffStore({
    ...deps,
    registry,
    // The harness session holds this document: the store resolves its Scope against the fleet
    // (ADR 0010), so a page scoped elsewhere reads no session at all.
    scope: deps.scope ?? {
      scope: { kind: "document" as const, document: address("C:\\Models\\Harness.rvt") },
    },
    slice,
    writer,
  });
  publishedSlice = store.slices.takeoffs;
  return store;
};

function harness() {
  const events = new Set<(event: SessionEvent) => void>();
  const calls = {
    sessions: 0,
    doc: 0,
    snapshot: 0,
    views: 0,
    candidates: 0,
    list: 0,
    open: 0,
    adopt: 0,
    initialize: 0,
  };
  let failSnapshot = false;
  let failR10 = false;
  let holdSnapshot = false;
  let documentTitle = "Harness.rvt";
  let documentId = "C:\\Models\\Harness.rvt";
  let releaseSnapshot: (() => void) | undefined;
  const snapshot: TakeoffSnapshot = {
    reading: {
      at: address(documentId),
      version: "v1",
      observedAt: "2026-08-25T00:00:00Z",
    },
    carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
    world: {
      docName: "Harness.rvt",
      r10Path: null,
      lanes: [{ view: bound.views[0]!, label: "Main", replayPath: null }],
      zones: [],
      systems: [],
    },
    zoneFrs: [],
    regionsByZone: {},
  };
  const sessions: SessionSource = {
    async list() {
      calls.sessions += 1;
      return [
        {
          sessionId: "bridge-dev-26",
          sdkSessionId: "dev-26",
          processId: 42,
          lane: "dev",
          custody: "controlled",
          year: "2026",
          activeDocumentTitle: documentTitle,
          activeDocumentId: documentId,
          openDocumentCount: 1,
        },
      ];
    },
    async activeDocument(session) {
      calls.doc += 1;
      return {
        session,
        documentId: session.activeDocumentId!,
        title: session.activeDocumentTitle!,
      };
    },
    subscribe(listener) {
      events.add(listener);
      return () => events.delete(listener);
    },
  };
  const host: TakeoffHost = {
    fixture: false,
    async readSnapshot(_session, _document, _views, write) {
      calls.snapshot += 1;
      if (failSnapshot) throw new Error("snapshot rejected");
      if (holdSnapshot) await new Promise<void>((resolve) => (releaseSnapshot = resolve));
      const next = {
        ...snapshot,
        reading: {
          at: address(documentId),
          version: "v2",
          observedAt: new Date().toISOString(),
        },
      };
      await write(next);
      return next;
    },
    async readViews() {
      calls.views += 1;
      return [
        { name: bound.views[0]!, level: "Main" },
        { name: "Zero Regions", level: "Roof" },
      ];
    },
    async listRhvac(dir) {
      calls.list += 1;
      return [{ path: `${dir}\\projectA.r10`, name: "projectA.r10" }];
    },
    async openRhvac(path) {
      calls.open += 1;
      if (failR10) throw new Error("r10 rejected");
      return {
        sourceFile: path,
        fileIdentity: { fileName: "projectA.r10", stamp: "test" },
        rooms: [],
        systems: [],
      };
    },
    async readCandidates() {
      calls.candidates += 1;
      return [];
    },
    async adopt() {
      calls.adopt += 1;
      return { text: "adopted" };
    },
    async initializeCarrier(_session, stage) {
      calls.initialize += 1;
      expect(stage).toBe("Adoption");
      return {
        status: "needs-initialization",
        bound: "b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001",
        remaining: ["b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9002"],
      };
    },
    async partition() {
      throw new Error("partition is outside this harness");
    },
    async writeDecisions() {
      return { blob: "{}" };
    },
    async writeRoomType() {},
    async launchRhvac() {},
    async syncRhvac() {
      return { text: "synced" };
    },
  };
  return {
    calls,
    host,
    snapshot,
    sessions,
    emit: (event: SessionEvent) => events.forEach((listener) => listener(event)),
    fail: () => (failSnapshot = true),
    failR10: () => (failR10 = true),
    recoverR10: () => (failR10 = false),
    hold: () => (holdSnapshot = true),
    release: () => releaseSnapshot?.(),
    setDocumentTitle: (title: string) => {
      documentTitle = title;
      documentId = `C:\\Models\\${title}`;
    },
  };
}

/** The document `createFixtureSessionSource` holds; a page Scope resolves against the fleet. */
const ProjectA_SCOPE = {
  scope: {
    kind: "document" as const,
    document: address("C:\\Fixtures\\project-a Residence.rvt"),
  },
};

describe("takeoff route store", () => {
  it("prepares all materialization carriers before partition and retains its immutable review ID", async () => {
    const h = harness();
    const fixtureRegistry = AtomRegistry.make();
    registries.push(fixtureRegistry);
    const fixture = createFixtureTakeoffStore(fixtureRegistry, ProjectA_SCOPE);
    const original = fixtureRegistry.get(fixture.atoms.world).zones[0]!;
    const zone = { ...original, zone: { ...original.zone, elementId: 123 } };
    let preparationCalls = 0;
    const host: TakeoffHost = {
      ...h.host,
      async initializeCarrier(_session, stage) {
        expect(stage).toBe("Materialization");
        preparationCalls += 1;
        return {
          status: preparationCalls === 1 ? "needs-initialization" : "ready",
          bound: "carrier",
          remaining: preparationCalls === 1 ? ["last-carrier"] : [],
        };
      },
      async partition() {
        expect(preparationCalls).toBe(2);
        return {
          review: {
            source: { runId: "immutable-captured-run", documentKey: "document", scopeKey: "scope" },
            zone: { key: "zone", name: "zone", loops: [] },
            shapes: [],
          },
          levelName: "Main",
          elevation: 0,
          created: 0,
          held: 6,
          rebound: 0,
          orphaned: 0,
          domainSqft: 0,
          claimedWallSqft: 0,
          excludedResidueSqft: 0,
          totalSqft: 0,
          profile: "test",
          failures: [],
          rooms: [],
          residues: [],
          regions: [],
        };
      },
    };
    const store = createStore({ host, sessions: h.sessions });
    await store.actions.partition(zone);
    expect(store.registry.get(store.atoms.review)).toEqual({
      zone: zone.zone.guid,
      source: "fresh solver",
      data: {
        source: { runId: "immutable-captured-run", documentKey: "document", scopeKey: "scope" },
        zone: { key: "zone", name: "zone", loops: [] },
        shapes: [],
      },
      flags: [],
    });
    await store.actions.refresh();
    expect(store.registry.get(store.atoms.review)).toBeNull();
    store.dispose();
    fixture.dispose();
  });

  it("selects a saved held native review after reload", async () => {
    const h = harness();
    const fixtureRegistry = AtomRegistry.make();
    registries.push(fixtureRegistry);
    const fixture = createFixtureTakeoffStore(fixtureRegistry, ProjectA_SCOPE);
    const zone = structuredClone(fixtureRegistry.get(fixture.atoms.world).zones[0]!);
    zone.zone.key = "Main#09";
    zone.stage = "partitioned";
    zone.rooms = [];
    const loops = zone.zone.loops.map((loop) => loop.map(([x, y]) => [x, y] as [number, number]));
    zone.savedReview = {
      source: {
        runId: "saved-run-09",
        documentKey: "C:\\Models\\Harness.rvt",
        scopeKey: zone.zone.guid,
      },
      zone: { key: zone.zone.guid, name: "Main Level 09", loops },
      shapes: [
        {
          id: "R01",
          kind: "residue",
          disposition: "held",
          reason: "no-floor",
          sqft: 100,
          label: [0, 0],
          loops,
        },
      ],
    };
    h.snapshot.world.zones = [zone];
    const store = createStore({ host: h.host, sessions: h.sessions });
    await store.actions.settle(store.atoms.snapshot);

    store.actions.setAtlasPage({ zoneKey: zone.zone.guid });

    expect(store.registry.get(store.atoms.review)).toMatchObject({
      zone: zone.zone.guid,
      source: "saved native",
      data: {
        source: { runId: "saved-run-09" },
        shapes: [{ disposition: "held", reason: "no-floor" }],
      },
    });
    zone.zone.key = "Renamed#99";
    zone.savedReview.zone.name = "Renamed after reorder";
    await store.actions.refresh();
    await store.actions.settle(store.atoms.snapshot);
    expect(store.registry.get(store.atoms.zoneKey)).toBe(zone.zone.guid);
    expect(store.registry.get(store.atoms.review)?.data?.zone.name).toBe("Renamed after reorder");
    store.dispose();
    fixture.dispose();
  });

  it("keeps held and void residues out of the RHVAC sync plan", async () => {
    const h = harness();
    const fixtureRegistry = AtomRegistry.make();
    registries.push(fixtureRegistry);
    const fixture = createFixtureTakeoffStore(fixtureRegistry, ProjectA_SCOPE);
    const zone = structuredClone(
      fixtureRegistry
        .get(fixture.atoms.world)
        .zones.find((candidate) => candidate.rooms.some((room) => room.data !== null))!,
    );
    const eligible = zone.rooms.find((room) => room.data !== null)!;
    eligible.elementId = 42;
    eligible.r10 = null;
    eligible.analysis = { state: "current", runId: "measure", floorZ: 0, ceilingZ: 8, hold: null };
    zone.rooms = [eligible];
    zone.residues = [
      { id: "held", reason: "held", rawSqft: 10, label: [0, 0], outer: [], holes: [] },
      { id: "void", reason: "void", rawSqft: 5, label: [0, 0], outer: [], holes: [] },
    ];
    zone.heldSqft = 15;
    h.snapshot.world.zones = [zone];
    const store = createStore({ host: h.host, sessions: h.sessions });
    await store.actions.settle(store.atoms.snapshot);

    expect(store.registry.get(store.atoms.syncPlan).inserts.map(({ room }) => room.guid)).toEqual([
      eligible.guid,
    ]);
    expect(store.registry.get(store.atoms.world).zones[0]!.residues).toEqual(zone.residues);
    eligible.analysis = { ...eligible.analysis!, state: "stale", hold: "geometry-changed" };
    await store.actions.refresh();
    await store.actions.settle(store.atoms.snapshot);
    expect(store.registry.get(store.atoms.syncPlan).inserts).toEqual([]);
    store.dispose();
    fixture.dispose();
  });

  it("starts the fixture lane with the dense project-a world before Host transport", () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
    registries.push(registry);
    const store = createFixtureTakeoffStore(registry, {
      scope: {
        kind: "document" as const,
        document: address("C:\\Fixtures\\project-a Residence.rvt"),
      },
    });
    const world = registry.get(store.atoms.world);

    expect(world.docName).toBe("project-a Residence.rvt");
    expect(world.zones.length).toBeGreaterThan(0);
    expect(world.zones.flatMap((zone) => zone.rooms).length).toBeGreaterThan(0);
    expect(world.zones.reduce((sum, zone) => sum + zone.zone.declaredSqft, 0)).toBeGreaterThan(0);
    expect(world.zones.map((zone) => zone.name)).toContain("Great Room");
  });

  it("produces a fixture snapshot accepted by the route document schema", async () => {
    const sessions = createFixtureSessionSource();
    const session = (await sessions.list())[0]!;
    const document = (await sessions.activeDocument(session))!;
    let snapshot: TakeoffSnapshot | undefined;

    const host = createFixtureTakeoffHost();
    const views = await host.readViews(session);
    await host.readSnapshot(session, document, views, async (value) => {
      snapshot = value;
    });

    const parsed = takeoffsRouteState.schema.safeParse({
      bindings: {},
      snapshot,
      staged: [],
    });
    if (!parsed.success) throw parsed.error;
    expect(parsed.success).toBe(true);
  });

  it("makes persisted snapshot and live view feeds ready", async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
    const sessions = createFixtureSessionSource();
    const session = (await sessions.list())[0]!;
    const document = (await sessions.activeDocument(session))!;
    const host = createFixtureTakeoffHost();
    const views = await host.readViews(session);
    const snapshot = await host.readSnapshot(session, document, views, async () => undefined);
    const slice = Atom.make(
      AsyncResult.success(
        {
          doc: { bindings: {}, snapshot, staged: [] },
          revision: 0,
          hydrated: true,
          connected: true,
          error: null,
          peaActive: false,
        },
        { waiting: true },
      ),
    );
    const store = createStore({
      registry,
      slice,
      host,
      sessions,
    });
    await store.actions.settle(store.atoms.viewFacts);

    expect(registry.get(store.feeds.views)).toMatchObject({ state: "ready", stale: false });
    expect(registry.get(store.feeds.zones)).toMatchObject({ state: "ready", stale: false });
    await store.actions.openAdopt();
    expect(registry.get(store.atoms.panel)).toBe("adopt");
    store.dispose();
  });

  it("binds a persisted snapshot from the current document", async () => {
    const h = harness();
    h.hold();
    const observedAt = "2026-08-25T01:02:03Z";
    const slice = Atom.make(
      AsyncResult.success({
        doc: {
          bindings: {
            world: {
              id: "dev-26" as const,
              label: "dev-26",
              at: address("C:\\Models\\Test.rvt"),
            },
          },
          snapshot: {
            ...h.snapshot,
            reading: {
              at: address("C:\\Models\\Harness.rvt"),
              version: "v1",
              observedAt,
            },
          },
          staged: [],
        },
        revision: 0,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
    const store = createStore({
      slice,
      host: h.host,
      sessions: h.sessions,
    });
    await store.actions.settle(store.atoms.activeDocument);

    const read = await store.actions.settle(store.atoms.snapshot);

    expect(read).toMatchObject({
      bound: true,
      at: Date.parse(observedAt),
      basis: ["C:\\Models\\Harness.rvt"],
    });
    h.release();
    store.dispose();
  });

  it("unbinds a persisted snapshot from another document", async () => {
    const h = harness();
    h.hold();
    const slice = Atom.make(
      AsyncResult.success({
        doc: {
          bindings: {
            world: {
              id: "dev-26" as const,
              label: "dev-26",
              at: address("C:\\Models\\Test.rvt"),
            },
          },
          snapshot: {
            ...h.snapshot,
            reading: {
              at: address("C:\\Models\\Other.rvt"),
              version: "v1",
              observedAt: "2026-08-25T01:02:03Z",
            },
          },
          staged: [],
        },
        revision: 0,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
    const store = createStore({
      slice,
      host: h.host,
      sessions: h.sessions,
    });
    await store.actions.settle(store.atoms.activeDocument);

    const read = await store.actions.settle(store.atoms.snapshot);

    expect(read).toMatchObject({ bound: false, value: null });
    h.release();
    store.dispose();
  });

  it("does not persist a destination world into the departing document", async () => {
    const h = harness();
    h.hold();
    const patches: RouteStatePatch[][] = [];
    const sessions: SessionSource = {
      ...h.sessions,
      async list() {
        return [
          ...(await h.sessions.list()),
          {
            sessionId: "bridge-other",
            sdkSessionId: "other",
            processId: 43,
            lane: "dev",
            custody: "controlled",
            year: "2026",
            activeDocumentTitle: "Other.rvt",
            activeDocumentId: "C:\\Models\\Other.rvt",
            openDocumentCount: 1,
          },
        ];
      },
    };
    const slice = Atom.make(
      AsyncResult.success({
        doc: {
          bindings: {
            world: {
              id: "dev-26" as const,
              label: "dev-26",
              at: address("C:\\Models\\Test.rvt"),
            },
          },
          snapshot: h.snapshot,
          staged: [],
        },
        revision: 0,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
    const store = createStore(
      {
        slice,
        host: h.host,
        sessions,
        target: "other",
      },
      (next) => patches.push(next),
    );
    await store.actions.settle(store.atoms.sessions);

    expect(store.atoms.registry.get(store.atoms.target)).toBe("other");

    store.actions.setBindings({ bound: { world: "other" } });
    await tick();

    expect(patches).toEqual([]);
    const landed = store.atoms.registry.get(store.slices.takeoffs);
    expect(AsyncResult.getOrThrow(landed).doc?.snapshot).toEqual(h.snapshot);
    h.release();
    store.dispose();
  });

  it("reconciles the URL world once after the destination document owns the store", async () => {
    const h = harness();
    h.setDocumentTitle("Other.rvt");
    const patches: RouteStatePatch[][] = [];
    const store = createStore(
      {
        host: h.host,
        sessions: h.sessions,
        scope: { scope: { kind: "document" as const, document: address("C:\\Models\\Other.rvt") } },
        target: "dev-26",
      },
      (next) => patches.push(next),
    );

    await store.actions.reconcileWorld();

    const worldPatches = () =>
      patches.flat().filter((patch) => patch.path[0] === "bindings" && patch.path[1] === "world");
    expect(worldPatches()).toEqual([
      {
        path: ["bindings", "world"],
        value: {
          id: "dev-26",
          label: "dev-26",
        },
      },
    ]);
    expect(
      AsyncResult.getOrThrow(store.atoms.registry.get(store.slices.takeoffs)).doc?.bindings.world,
    ).toEqual({
      id: "dev-26",
      label: "dev-26",
    });

    const matchedPatches: RouteStatePatch[][] = [];
    const reconciled = AsyncResult.getOrThrow(store.atoms.registry.get(store.slices.takeoffs));
    const matchedStore = createStore(
      {
        host: h.host,
        sessions: h.sessions,
        scope: { scope: { kind: "document" as const, document: address("C:\\Models\\Other.rvt") } },
        target: "dev-26",
        slice: Atom.make(AsyncResult.success(reconciled)),
      },
      (next) => matchedPatches.push(next),
    );

    await matchedStore.actions.reconcileWorld();

    expect(
      matchedPatches
        .flat()
        .filter((patch) => patch.path[0] === "bindings" && patch.path[1] === "world"),
    ).toEqual([]);
    matchedStore.dispose();
    store.dispose();
  });

  it("writes the fixture host read into the document and renders only that slice", async () => {
    const patches: RouteStatePatch[][] = [];
    const store = createStore(
      {
        host: createFixtureTakeoffHost(),
        sessions: createFixtureSessionSource(),
        scope: ProjectA_SCOPE,
      },
      (next) => patches.push(next),
    );
    await store.actions.settle(store.atoms.snapshot);

    expect(patches[0]?.[0]).toMatchObject({ path: ["snapshot"] });
    expect(store.atoms.registry.get(store.atoms.world).docName).toBe("project-a Residence.rvt");
    store.dispose();
  });

  it("writes one apply patch for a staged room edit", async () => {
    const patches: RouteStatePatch[][] = [];
    const store = createStore(
      {
        host: createFixtureTakeoffHost(),
        sessions: createFixtureSessionSource(),
        scope: ProjectA_SCOPE,
      },
      (next) => patches.push(next),
    );
    await store.actions.settle(store.atoms.snapshot);
    patches.length = 0;

    await store.actions.stage("room-1", { name: "Old" }, { name: "Proposed" });

    expect(patches).toEqual([
      [
        {
          path: ["staged"],
          value: [{ roomId: "room-1", base: { name: "Old" }, next: { name: "Proposed" } }],
        },
      ],
    ]);
    store.dispose();
  });

  it("swaps the whole capability root for the project-a fixture", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      scope: ProjectA_SCOPE,
    });
    store.actions.setSelection({ ...EMPTY_TAKEOFF_SELECTION, source: "fixture" });

    const snapshot = await store.actions.settle(store.atoms.snapshot);

    expect(snapshot.value!.world.docName).toBe("project-a Residence.rvt");
    store.dispose();
  });

  it("keeps Atlas page state and per-room decisions on the registry", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      scope: ProjectA_SCOPE,
    });
    store.actions.setSelection({ ...EMPTY_TAKEOFF_SELECTION, source: "fixture" });
    await store.actions.settle(store.atoms.snapshot);
    const room = store.atoms.registry
      .get(store.atoms.world)
      .zones.flatMap((zone) => zone.rooms)[0]!;
    const zone = store.atoms.registry.get(store.atoms.world).zones[0]!;

    store.actions.setAtlasPage({
      level: "Main",
      zoneKey: zone.zone.guid,
      cursor: room.guid,
      planOpen: false,
      statsOpen: true,
    });
    store.actions.hover(room.guid);
    store.actions.patchRoom(room.guid, { name: "Staged room" });
    store.actions.decide(room.guid, "thin residue", "accept");
    store.actions.setTargetingOpen("zones");
    store.actions.setTargetingLevel("views");
    store.actions.setTargetingQuery("main");

    expect(store.atoms.registry.get(store.atoms.level)).toBe("Main");
    expect(store.atoms.registry.get(store.atoms.cursor)).toBe(room.guid);
    expect(store.atoms.registry.get(store.atoms.planOpen)).toBe(false);
    expect(store.atoms.registry.get(store.atoms.statsOpen)).toBe(true);
    expect(store.atoms.registry.get(store.atoms.entity(room.guid))).toMatchObject({
      hovered: true,
      selected: true,
      dirty: true,
      staged: { base: { name: room.name }, next: { name: "Staged room" } },
    });
    expect(store.atoms.registry.get(store.atoms.entity(room.guid)).decided).toEqual({
      "thin residue": "accept",
    });
    expect(
      store.atoms.registry
        .get(store.atoms.world)
        .zones.flatMap((zone) => zone.rooms)
        .find((candidate) => candidate.guid === room.guid)?.name,
    ).toBe("Staged room");
    expect(store.atoms.registry.get(store.atoms.decisions)).toEqual({
      [`${room.guid}::thin residue`]: "accept",
    });
    expect(store.atoms.registry.get(store.atoms.targetingOpen)).toBe("zones");
    expect(store.atoms.registry.get(store.atoms.targetingLevel)).toBe("views");
    expect(store.atoms.registry.get(store.atoms.targetingQuery)).toBe("main");
    store.dispose();
  });

  it("derives visible room order from table sort and filter state", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      scope: ProjectA_SCOPE,
    });
    store.actions.setSelection({ ...EMPTY_TAKEOFF_SELECTION, source: "fixture" });
    await store.actions.settle(store.atoms.snapshot);

    store.actions.setSort([{ key: "name", dir: "desc" }]);
    const sorted = store.atoms.registry.get(store.atoms.visibleRows);
    store.actions.setTableState({
      filters: { type: "bedroom" },
      sorts: [{ key: "name", dir: "asc" }],
      query: "",
    });
    const filtered = store.atoms.registry.get(store.atoms.visibleRows);

    expect(sorted.slice(0, 3)).toEqual([
      "7a4e-room-2cb7863f-0005",
      "7a4e-room-2eb78965-0000",
      "7a4e-room-2eb78965-0002",
    ]);
    expect(filtered).toEqual([
      "7a4e-room-2bb784ac-0000",
      "7a4e-room-179f7d80-0000",
      "7a4e-room-189d407c-0000",
      "7a4e-room-2bb784ac-0001",
      "7a4e-room-179f7d80-0001",
      "7a4e-room-189d407c-0001",
      "7a4e-room-2bb784ac-0002",
      "7a4e-room-179f7d80-0002",
      "7a4e-room-189d407c-0002",
      "7a4e-room-2bb784ac-0003",
      "7a4e-room-179f7d80-0003",
      "7a4e-room-179f7d80-0004",
      "7a4e-room-179f7d80-0005",
    ]);
    store.dispose();
    expect(store.atoms.registry.get(store.atoms.visibleRows)).toEqual(filtered);
  });

  it("keeps derived row identities stable when only the cursor changes", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      scope: ProjectA_SCOPE,
    });
    store.actions.setSelection({ ...EMPTY_TAKEOFF_SELECTION, source: "fixture" });
    await store.actions.settle(store.atoms.snapshot);
    const rows = store.atoms.registry.get(store.atoms.atlasRows);
    const visibleRows = store.atoms.registry.get(store.atoms.visibleRows);
    expect(rows).toHaveLength(180);

    store.actions.setAtlasPage({ cursor: visibleRows[0] });

    expect(store.atoms.registry.get(store.atoms.atlasRows)).toBe(rows);
    expect(store.atoms.registry.get(store.atoms.visibleRows)).toBe(visibleRows);
    store.dispose();
  });

  it("does not invent a conflict from nested Manual J base fields", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      scope: ProjectA_SCOPE,
    });
    store.actions.setSelection({ ...EMPTY_TAKEOFF_SELECTION, source: "fixture" });
    await store.actions.settle(store.atoms.snapshot);
    const room = store.atoms.registry
      .get(store.atoms.world)
      .zones.flatMap((zone) => zone.rooms)
      .find((candidate) => candidate.data !== null)!;

    store.actions.patchRoom(room.guid, { name: "Staged room" });

    expect(store.atoms.registry.get(store.atoms.entity(room.guid))).toMatchObject({
      dirty: true,
      conflict: false,
    });
    store.dispose();
  });

  it("keeps a failed live read as an error instead of falling back to a fixture snapshot", async () => {
    const h = harness();
    const session = (await h.sessions.list())[0]!;
    const document = await h.sessions.activeDocument(session);
    const fixtureHost = createFixtureTakeoffHost();
    const fixture = await fixtureHost.readSnapshot(
      session,
      document,
      await fixtureHost.readViews(session),
      async () => undefined,
    );
    const slice = Atom.make(
      AsyncResult.success({
        doc: { bindings: {}, snapshot: fixture, staged: [] },
        revision: 0,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
    h.fail();
    const store = createStore({
      slice,
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);

    await vi.waitFor(() => expect(store.atoms.registry.get(store.feeds.zones).state).toBe("error"));
    await expect(store.actions.settle(store.atoms.snapshot)).rejects.toThrow("snapshot rejected");
    store.dispose();
  });

  it("projects a snapshot failure into every snapshot-backed feed", async () => {
    const h = harness();
    h.fail();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);

    await expect(store.actions.settle(store.atoms.snapshot)).rejects.toThrow("snapshot rejected");

    expect(store.atoms.registry.get(store.feeds.zones).state).toBe("error");
    store.dispose();
  });

  it("drops the active document when the session opens another one", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);
    await Promise.all([
      store.actions.settle(store.atoms.snapshot),
      store.actions.settle(store.atoms.r10),
    ]);
    const before = { ...h.calls };

    h.setDocumentTitle("Second.rvt");
    h.emit({ kind: "docChanged", sessionId: "bridge-dev-26" });
    await tick();
    await store.actions.settle(store.atoms.snapshot);

    expect(h.calls.sessions).toBe(before.sessions + 1);
    expect(h.calls.list).toBe(before.list);
    expect(h.calls.open).toBe(before.open);
    // The page's Scope names Harness.rvt; nobody holds it now, so the page reads no document
    // rather than silently following the session onto Second.rvt (ADR 0010 `unheld`).
    expect(
      AsyncResult.getOrThrow(store.atoms.registry.get(store.atoms.activeDocument)).value,
    ).toBeNull();
    expect(
      AsyncResult.getOrThrow(store.atoms.registry.get(store.atoms.sessions)).value[0]
        ?.activeDocumentTitle,
    ).toBe("Second.rvt");
    store.dispose();
  });

  it("does not rebox an opened .r10 into the document world", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);
    await Promise.all([
      store.actions.settle(store.atoms.snapshot),
      store.actions.settle(store.atoms.r10),
    ]);

    expect(store.atoms.registry.get(store.atoms.world).r10Path).toBeNull();
    expect(h.calls.open).toBe(1);
    store.dispose();
  });

  it("retries a failed .r10 list and open", async () => {
    const h = harness();
    h.failR10();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);
    await expect(store.actions.settle(store.atoms.r10)).rejects.toThrow("r10 rejected");
    const before = { ...h.calls };

    h.recoverR10();
    await store.actions.retryRhvac();
    await store.actions.settle(store.atoms.r10);

    expect(h.calls.list).toBe(before.list + 1);
    expect(h.calls.open).toBeGreaterThan(before.open);
    expect(store.atoms.registry.get(store.atoms.receipt)?.verb).toBe("retry-r10");
    store.dispose();
  });

  it("concatenates candidates and adopts once per bound view", async () => {
    const h = harness();
    const adopted: Array<Parameters<TakeoffHost["adopt"]>[1]> = [];
    const host: TakeoffHost = {
      ...h.host,
      async readCandidates(_session, view) {
        return [
          {
            elementId: view === "North" ? 1 : 2,
            typeName: `${view} zone`,
            view: "wrong source tag",
            color: "1,2,3",
            sqft: 100,
            role: "zoning-region",
            guid: null,
            blob: JSON.stringify({ view, name: `${view} zone`, systemTag: "A" }),
            loops: [],
          },
        ];
      },
      async adopt(_session, input) {
        adopted.push(input);
        return { text: "host receipt" };
      },
    };
    const store = createStore({ host, sessions: h.sessions });
    store.actions.setSelection({ ...bound, views: ["North", "South"] });

    const candidates = await store.actions.settle(store.atoms.candidates);
    expect(candidates.value.map((candidate) => candidate.view)).toEqual(["North", "South"]);
    await store.actions.adoptSelected();

    expect(adopted).toEqual([
      {
        view: "North",
        items: [{ elementId: 1, name: "North zone", systemTag: "A" }],
      },
      {
        view: "South",
        items: [{ elementId: 2, name: "South zone", systemTag: "A" }],
      },
    ]);
    expect(store.atoms.registry.get(store.atoms.receipt)).toMatchObject({
      verb: "adopt",
      text: "2 regions across 2 views",
    });
    store.dispose();
  });

  it("initializes one adoption carrier and invalidates the snapshot", async () => {
    const h = harness();
    const store = createStore({ host: h.host, sessions: h.sessions });
    await store.actions.settle(store.atoms.snapshot);
    const snapshotsBefore = h.calls.snapshot;

    const result = await store.actions.initializeCarrier("Adoption");
    await tick();

    expect(result).toMatchObject({
      bound: "b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001",
      remaining: ["b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9002"],
    });
    expect(h.calls.initialize).toBe(1);
    expect(h.calls.snapshot).toBeGreaterThan(snapshotsBefore);
    store.dispose();
  });

  it("adopts the selected view through the fixture host", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      scope: ProjectA_SCOPE,
    });
    store.actions.setSelection({
      ...EMPTY_TAKEOFF_SELECTION,
      source: "fixture",
      views: ["Mechanical Zoning Plan - Lower Level"],
    });
    await store.actions.settle(store.atoms.candidates);
    await tick();

    expect(store.atoms.registry.get(store.atoms.adoptRows)).toHaveLength(11);
    await store.actions.openAdopt();
    await store.actions.adoptSelected();

    expect(store.atoms.registry.get(store.atoms.panel)).toBeNull();
    expect(store.atoms.registry.get(store.atoms.receipt)).toMatchObject({
      verb: "adopt",
      text: "11 regions across 1 views",
    });
    store.dispose();
  });
});
