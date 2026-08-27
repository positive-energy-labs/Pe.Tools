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
      if (!AsyncResult.isSuccess(current) || !current.value.doc) return { ok: false as const };
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
      return { ok: true as const };
    },
    async command() {
      return { ok: true as const };
    },
  };
  const store = createTakeoffStore({
    ...deps,
    registry,
    scope: deps.scope ?? { documentAddress: address("C:\\Models\\Test.rvt") },
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
        { name: bound.views[0]!, level: "Main", regions: 1 },
        { name: "Zero Regions", level: "Roof", regions: 0 },
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

describe("takeoff route store", () => {
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

  it("does not offer a view with zero filled regions", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);

    await store.actions.settle(store.atoms.viewFacts);

    expect(store.atoms.registry.get(store.feeds.views).options).toEqual([
      { id: bound.views[0], label: bound.views[0], sub: "Main · 1 region" },
    ]);
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
              id: "session:dev-26",
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
              id: "session:dev-26",
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

  it("binds equal-titled sessions by distinct document identity without an RPC", async () => {
    const h = harness();
    const patches: RouteStatePatch[][] = [];
    const title = "Equal title.rvt";
    const sessions: SessionSource = {
      ...h.sessions,
      async list() {
        return [
          {
            sessionId: "bridge-a",
            sdkSessionId: "world-a",
            processId: 41,
            lane: "dev",
            custody: "controlled",
            activeDocumentTitle: title,
            activeDocumentId: "C:\\Models\\A.rvt",
            openDocumentCount: 1,
          },
          {
            sessionId: "bridge-b",
            sdkSessionId: "world-b",
            processId: 42,
            lane: "dev",
            custody: "controlled",
            activeDocumentTitle: title,
            activeDocumentId: "C:\\Models\\B.rvt",
            openDocumentCount: 1,
          },
        ];
      },
    };
    const store = createStore({ host: h.host, sessions }, (next) => patches.push(next));
    await store.actions.settle(store.atoms.sessions);

    store.actions.setBindings({ bound: { world: "session:world-a" } });
    await tick();
    const first = await store.actions.settle(store.atoms.activeDocument);
    expect(h.calls.doc).toBe(1);

    store.actions.setBindings({ bound: { world: "session:world-b" } });
    await tick();
    const second = await store.actions.settle(store.atoms.activeDocument);
    expect(h.calls.doc).toBe(2);

    expect([first.value?.documentId, second.value?.documentId]).toEqual([
      "C:\\Models\\A.rvt",
      "C:\\Models\\B.rvt",
    ]);
    expect(first.value?.title).toBe(second.value?.title);
    expect(
      patches.flatMap((batch) =>
        batch.flatMap((patch) =>
          patch.path[0] === "bindings" && patch.path[1] === "world"
            ? [(patch.value as { id: string }).id]
            : [],
        ),
      ),
    ).toEqual(["session:world-a", "session:world-b"]);
    store.dispose();
  });

  it("binds another document without clearing the snapshot", async () => {
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
              id: "session:dev-26",
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
      },
      (next) => patches.push(next),
    );
    await store.actions.settle(store.atoms.sessions);

    store.actions.setBindings({ bound: { world: "session:other" } });
    await tick();

    expect(patches).toContainEqual([
      {
        path: ["bindings", "world"],
        value: expect.objectContaining({ id: "session:other" }),
      },
    ]);
    const landed = store.atoms.registry.get(store.slices.takeoffs);
    expect(AsyncResult.getOrThrow(landed).doc?.snapshot).toEqual(h.snapshot);
    h.release();
    store.dispose();
  });

  it("writes the fixture host read into the document and renders only that slice", async () => {
    const patches: RouteStatePatch[][] = [];
    const store = createStore(
      {
        host: createFixtureTakeoffHost(),
        sessions: createFixtureSessionSource(),
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
    });
    store.actions.setSelection({ ...EMPTY_TAKEOFF_SELECTION, source: "fixture" });
    await store.actions.settle(store.atoms.snapshot);
    const room = store.atoms.registry
      .get(store.atoms.world)
      .zones.flatMap((zone) => zone.rooms)[0]!;
    const zone = store.atoms.registry.get(store.atoms.world).zones[0]!;

    store.actions.setAtlasPage({
      level: "Main",
      zoneKey: zone.zone.key,
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

  it("brackets capture and publishes its replay through the store world", async () => {
    const h = harness();
    const store = createStore({
      host: h.host,
      sessions: h.sessions,
    });
    store.actions.setSelection(bound);
    await store.actions.settle(store.atoms.snapshot);

    await store.actions.capture({ view: bound.views[0]!, label: "Main" });

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

  it("refreshes the active document after a pushed document change", async () => {
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
    expect(h.calls.doc).toBeGreaterThan(before.doc);
    expect(h.calls.snapshot).toBeGreaterThan(before.snapshot);
    expect(h.calls.list).toBe(before.list);
    expect(h.calls.open).toBe(before.open);
    expect(
      AsyncResult.getOrThrow(store.atoms.registry.get(store.atoms.activeDocument)).value,
    ).toMatchObject({
      documentId: "C:\\Models\\Second.rvt",
      title: "Second.rvt",
    });
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

  it("adopts the selected view through the fixture host", async () => {
    const store = createStore({
      host: createFixtureTakeoffHost(),
      sessions: createFixtureSessionSource(),
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
