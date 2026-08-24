import { describe, expect, it } from "vite-plus/test";

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

function harness() {
  const events = new Set<(event: SessionEvent) => void>();
  const calls = { sessions: 0, doc: 0, snapshot: 0, list: 0, open: 0, adopt: 0 };
  let failSnapshot = false;
  let holdSnapshot = false;
  let releaseSnapshot: (() => void) | undefined;
  const snapshot: TakeoffSnapshot = {
    world: { docName: "Harness.rvt", r10Path: null, lanes: [], zones: [], systems: [] },
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
      return snapshot;
    },
    async listRhvac(dir) {
      calls.list += 1;
      return [{ path: `${dir}\\projectA.r10`, name: "projectA.r10" }];
    },
    async openRhvac(path) {
      calls.open += 1;
      return { path };
    },
    async adopt() {
      calls.adopt += 1;
      return { text: "adopted" };
    },
  };
  return {
    calls,
    host,
    sessions,
    emit: (event: SessionEvent) => events.forEach((listener) => listener(event)),
    fail: () => (failSnapshot = true),
    hold: () => (holdSnapshot = true),
    release: () => releaseSnapshot?.(),
  };
}

describe("takeoff route store", () => {
  it("clears every declared descendant when a trunk is re-picked", () => {
    const h = harness();
    const search = searchPort();
    const store = createTakeoffStore({ host: h.host, sessions: h.sessions, search: search.port });
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
    const store = createTakeoffStore({
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
    const store = createTakeoffStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
      search: searchPort().port,
    });
    store.actions.setSearch({ ...EMPTY_TAKEOFF_SEARCH, source: "fixture", target: "fixture" });
    await store.actions.settle(store.atoms.snapshot);
    const room = store.atoms.registry
      .get(store.atoms.world)
      .zones.flatMap((zone) => zone.rooms)[0]!;

    store.actions.setAtlasPage({ level: "Main", cursor: room.guid });
    store.actions.decide(room.guid, "thin residue", "accept");

    expect(store.atoms.registry.get(store.atoms.atlasPage)).toMatchObject({
      level: "Main",
      cursor: room.guid,
    });
    expect(store.atoms.registry.get(store.atoms.entity(room.guid)).decided).toEqual({
      "thin residue": "accept",
    });
    expect(store.atoms.registry.get(store.atoms.decisions)).toEqual({
      [`${room.guid}::thin residue`]: "accept",
    });
    store.dispose();
  });

  it("keeps the prior snapshot stale after adopt, then re-reads it", async () => {
    const h = harness();
    const store = createTakeoffStore({
      host: h.host,
      sessions: h.sessions,
      search: searchPort().port,
    });
    store.actions.setSearch(bound);
    await store.actions.settle(store.atoms.snapshot);
    h.hold();

    await store.actions.adopt({ view: bound.view, items: [] });
    await tick();

    expect(store.atoms.registry.get(store.feeds.zones).state).toBe("stale");
    h.release();
    await store.actions.settle(store.atoms.snapshot);
    expect(h.calls.adopt).toBe(1);
    expect(h.calls.snapshot).toBe(2);
    expect(store.atoms.registry.get(store.feeds.zones).state).toBe("fresh");
    store.dispose();
  });

  it("projects a snapshot failure into every snapshot-backed feed", async () => {
    const h = harness();
    h.fail();
    const store = createTakeoffStore({
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
    const store = createTakeoffStore({
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
});
