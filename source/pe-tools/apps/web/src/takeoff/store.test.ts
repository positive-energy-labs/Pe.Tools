import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import {
  createFixtureTakeoffHost,
  createFixtureSessionSource,
} from "#/takeoff/proto/fixture-world";
import {
  createTakeoffStore,
  EMPTY_TAKEOFF_SEARCH,
  type SearchPort,
  type SessionEvent,
  type SessionSource,
  type TakeoffHost,
  type TakeoffSearch,
  type TakeoffSnapshot,
} from "#/takeoff/store";

const bound: TakeoffSearch = {
  ...EMPTY_TAKEOFF_SEARCH,
  target: "session:dev-26",
  view: "Mechanical Zoning Plan - Main Level",
  zones: ["zone-1"],
  dir: "C:\\Takeoffs",
  r10: "C:\\Takeoffs\\projectA.r10",
  stage: "audit",
};

const searchPort = () => {
  const patches: Partial<TakeoffSearch>[] = [];
  return {
    patches,
    port: { patch: (patch) => patches.push(patch) } satisfies SearchPort,
  };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
});

const createStore = (deps: Omit<Parameters<typeof createTakeoffStore>[0], "registry">) => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  registries.push(registry);
  return createTakeoffStore({
    ...deps,
    registry,
  });
};

function harness() {
  const events = new Set<(event: SessionEvent) => void>();
  const calls = { sessions: 0, doc: 0, snapshot: 0, candidates: 0, list: 0, open: 0, adopt: 0 };
  let failSnapshot = false;
  let liveProjection = false;
  let holdSnapshot = false;
  let releaseSnapshot: (() => void) | undefined;
  const snapshot: TakeoffSnapshot = {
    world: {
      docName: "Harness.rvt",
      r10Path: null,
      lanes: [{ view: bound.view, label: "Main", replayPath: null }],
      zones: [],
      systems: [],
    },
    views: [{ name: bound.view, level: "Main", regions: 1 }],
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
          activeDocumentTitle: "Harness.rvt",
          openDocumentCount: 1,
        },
      ];
    },
    async activeDocument(session) {
      calls.doc += 1;
      return { session, title: "Harness.rvt" };
    },
    subscribe(listener) {
      events.add(listener);
      return () => events.delete(listener);
    },
  };
  const host: TakeoffHost = {
    fixture: false,
    async readSnapshot() {
      calls.snapshot += 1;
      if (failSnapshot) throw new Error("snapshot rejected");
      if (holdSnapshot) await new Promise<void>((resolve) => (releaseSnapshot = resolve));
      return liveProjection
        ? { ...snapshot, status: { doc: "Harness.rvt", systems: [], regions: [] } }
        : snapshot;
    },
    async listRhvac(dir) {
      calls.list += 1;
      return [{ path: `${dir}\\projectA.r10`, name: "projectA.r10" }];
    },
    async openRhvac(path) {
      calls.open += 1;
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
    async capture() {
      return { replayPath: "C:\\Takeoffs\\replay_Main.bin", rooms: 1, totalSqft: 100 };
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
    sessions,
    emit: (event: SessionEvent) => events.forEach((listener) => listener(event)),
    fail: () => (failSnapshot = true),
    live: () => (liveProjection = true),
    hold: () => (holdSnapshot = true),
    release: () => releaseSnapshot?.(),
  };
}

describe("takeoff route store", () => {
  it("clears every declared descendant when a trunk is re-picked", () => {
    const h = harness();
    const search = searchPort();
    const store = createStore({ host: h.host, sessions: h.sessions, search: search.port });
    store.actions.setSearch(bound);

    store.actions.pick("world", "session:other");

    expect(search.patches.at(-1)).toMatchObject({
      target: "session:other",
      view: "",
      zones: [],
      dir: bound.dir,
      r10: bound.r10,
    });
    store.dispose();
  });

  it("swaps the whole capability root for the project-a fixture", async () => {
    const search = searchPort();
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      search: search.port,
    });
    store.actions.setSearch({ ...EMPTY_TAKEOFF_SEARCH, source: "fixture", target: "fixture" });

    const snapshot = await store.actions.settle(store.atoms.snapshot);

    expect(snapshot.value!.world.docName).toBe("project-a Residence.rvt");
    expect(store.atoms.registry.get(store.feeds.world).state).toBe("fixture");
    store.dispose();
  });

  it("keeps Atlas page state and per-room decisions on the registry", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      search: searchPort().port,
    });
    store.actions.setSearch({ ...EMPTY_TAKEOFF_SEARCH, source: "fixture", target: "fixture" });
    await store.actions.settle(store.atoms.snapshot);
    const room = store.atoms.registry
      .get(store.atoms.world)
      .zones.flatMap((zone) => zone.rooms)[0]!;
    const zone = store.atoms.registry.get(store.atoms.world).zones[0]!;

    store.actions.setAtlasPage({ level: "Main", cursor: room.guid });
    store.actions.focusZone(zone.zone.guid);
    store.actions.selectRoom(room.guid);
    store.actions.hover(room.guid);
    store.actions.patchRoom(room.guid, { name: "Staged room" });
    store.actions.decide(room.guid, "thin residue", "accept");

    expect(store.atoms.registry.get(store.atoms.atlasPage)).toMatchObject({
      level: "Main",
      cursor: room.guid,
    });
    expect(store.atoms.registry.get(store.atoms.entity(room.guid))).toMatchObject({
      hovered: true,
      selected: true,
      dirty: true,
      staged: { base: { name: room.name }, next: { name: "Staged room" } },
    });
    expect(store.atoms.registry.get(store.atoms.entity(zone.zone.guid)).selected).toBe(true);
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
    store.dispose();
  });

  it("derives visible room order from table sort and filter state", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      search: searchPort().port,
    });
    store.actions.setSearch({ ...EMPTY_TAKEOFF_SEARCH, source: "fixture", target: "fixture" });
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

  it("does not invent a conflict from nested Manual J base fields", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      search: searchPort().port,
    });
    store.actions.setSearch({ ...EMPTY_TAKEOFF_SEARCH, source: "fixture", target: "fixture" });
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

  it("keeps the prior snapshot stale after adopt, then re-reads it", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
      search: searchPort().port,
    });
    store.actions.setSearch(bound);
    await Promise.all([
      store.actions.settle(store.atoms.snapshot),
      store.actions.settle(store.atoms.candidates),
    ]);
    h.hold();

    await store.actions.adopt({ view: bound.view, items: [] });
    await tick();

    expect(store.atoms.registry.get(store.feeds.zones).state).toBe("stale");
    h.release();
    await store.actions.settle(store.atoms.snapshot);
    expect(h.calls.adopt).toBe(1);
    expect(h.calls.snapshot).toBe(2);
    expect(h.calls.candidates).toBe(2);
    expect(store.atoms.registry.get(store.feeds.zones).state).toBe("fresh");
    store.dispose();
  });

  it("brackets capture and publishes its replay through the store world", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
      search: searchPort().port,
    });
    store.actions.setSearch(bound);
    await store.actions.settle(store.atoms.snapshot);

    await store.actions.capture({ view: bound.view, label: "Main" });

    expect(store.atoms.registry.get(store.atoms.busy)).toBeNull();
    expect(store.atoms.registry.get(store.atoms.receipt)).toMatchObject({
      verb: "capture",
      text: "captured Main: 1 rooms",
    });
    expect(store.atoms.registry.get(store.atoms.world).lanes[0]?.replayPath).toBe(
      "C:\\Takeoffs\\replay_Main.bin",
    );
    store.dispose();
  });

  it("projects a snapshot failure into every snapshot-backed feed", async () => {
    const h = harness();
    h.fail();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
      search: searchPort().port,
    });
    store.actions.setSearch(bound);

    await expect(store.actions.settle(store.atoms.snapshot)).rejects.toThrow("snapshot rejected");

    expect(store.atoms.registry.get(store.feeds.view)).toMatchObject({
      state: "error",
      note: expect.stringContaining("snapshot rejected"),
    });
    expect(store.atoms.registry.get(store.feeds.zones).state).toBe("error");
    store.dispose();
  });

  it("cascades one pushed document invalidation through doc and snapshot only", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
      search: searchPort().port,
    });
    store.actions.setSearch(bound);
    await Promise.all([
      store.actions.settle(store.atoms.snapshot),
      store.actions.settle(store.atoms.r10),
    ]);
    const before = { ...h.calls };

    h.emit({ kind: "docChanged", sessionId: "bridge-dev-26" });
    await tick();
    await store.actions.settle(store.atoms.snapshot);

    expect(h.calls.doc).toBe(before.doc + 1);
    expect(h.calls.snapshot).toBe(before.snapshot + 1);
    expect(h.calls.list).toBe(before.list);
    expect(h.calls.open).toBe(before.open);
    store.dispose();
  });

  it("joins the opened .r10 into a live authority world", async () => {
    const h = harness();
    h.live();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
      search: searchPort().port,
    });
    store.actions.setSearch(bound);
    await Promise.all([
      store.actions.settle(store.atoms.snapshot),
      store.actions.settle(store.atoms.r10),
    ]);

    expect(store.atoms.registry.get(store.atoms.world).r10Path).toBe(bound.r10);
    expect(h.calls.open).toBe(1);
    store.dispose();
  });

  it("adopts the selected view through the fixture host", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      search: searchPort().port,
    });
    store.actions.setSearch({
      ...EMPTY_TAKEOFF_SEARCH,
      source: "fixture",
      view: "Mechanical Zoning Plan - Lower Level",
    });
    await store.actions.settle(store.atoms.candidates);
    await tick();

    expect(store.atoms.registry.get(store.atoms.adoptRows)).toHaveLength(11);
    store.inspect();
    store.actions.openPanel("adopt");
    await store.actions.adoptSelected();

    expect(store.atoms.registry.get(store.atoms.panel)).toBeNull();
    expect(store.atoms.registry.get(store.atoms.receipt)).toMatchObject({
      verb: "adopt",
      text: "fixture adopted 11 zoning regions",
    });
    const inspection = store.inspect();
    expect(inspection.nodes.some((node) => node.label === "takeoffs/verb/adopt")).toBe(true);
    expect(inspection.changes.some((change) => change.cause?.verb === "adopt")).toBe(true);
    store.dispose();
  });
});
