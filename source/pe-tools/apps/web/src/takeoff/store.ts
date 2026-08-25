import { Cause, Effect, Layer, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import type { MasterTableState } from "#/components/master-table/model";
import { mintSelector, resolveTarget, type SessionFacts } from "#/host/target";
import { inspectAtomRegistry, type InspectableAtomStore } from "#/state/atom-inspect";
import type { AdoptItem } from "#/takeoff/scripts";
import {
  upsertResolution,
  type CandidateRegion,
  type LiveRegion,
  type ModelStatus,
  type PartitionRun,
  type Resolution,
  type ViewFacts,
} from "#/takeoff/model";
import type { PartitionArgs } from "#/takeoff/scripts";
import {
  applyEdit,
  buildLiveWorld,
  emptyOverlay,
  readZoneMeta,
  STAGE_ORDER,
  type RoomEdit,
  type World,
  type WorldLane,
  type WorldRoom,
  type WorldZone,
} from "#/takeoff/world";
import {
  pickInto,
  type Bound,
  type Feed,
  type Link,
  type Multi,
  type Product,
} from "#/targeting/model";

export type TakeoffStage = "adopt" | "audit" | "sync";

export interface TakeoffSearch {
  readonly target: string;
  readonly source: "live" | "fixture";
  readonly view: string;
  readonly zones: readonly string[];
  readonly dir: string;
  readonly r10: string;
  readonly stage: TakeoffStage;
}

export const EMPTY_TAKEOFF_SEARCH: TakeoffSearch = {
  target: "",
  source: "live",
  view: "",
  zones: [],
  dir: "",
  r10: "",
  stage: "adopt",
};

export interface SearchPort {
  patch(partial: Partial<TakeoffSearch>): void;
}

export type SessionEvent =
  | { readonly kind: "docChanged"; readonly sessionId: string }
  | { readonly kind: "sessionsChanged"; readonly sessionId: string };

export interface ActiveDocument {
  readonly session: SessionFacts;
  readonly title: string;
}

export interface SessionSource {
  list(): Promise<SessionFacts[]>;
  activeDocument(session: SessionFacts): Promise<ActiveDocument>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface TakeoffSnapshot {
  readonly world: World;
  readonly status?: ModelStatus;
  readonly views: ViewFacts[];
  readonly zoneFrs: CandidateRegion[];
  readonly regionsByZone: Record<string, LiveRegion[]>;
}

export interface RhvacFile {
  readonly path: string;
  readonly name: string;
}

export interface TakeoffHost {
  readonly fixture: boolean;
  readSnapshot(session: SessionFacts, document: ActiveDocument): Promise<TakeoffSnapshot>;
  listRhvac(dir: string): Promise<RhvacFile[]>;
  openRhvac(path: string): Promise<unknown>;
  readCandidates(session: SessionFacts, view: string): Promise<CandidateRegion[]>;
  adopt(
    session: SessionFacts,
    input: { readonly view: string; readonly items: readonly AdoptItem[] },
  ): Promise<{ readonly text: string }>;
  capture(
    session: SessionFacts,
    lane: Pick<WorldLane, "view" | "label">,
  ): Promise<{ readonly replayPath: string; readonly rooms: number; readonly totalSqft: number }>;
  partition(session: SessionFacts, input: PartitionArgs): Promise<PartitionRun>;
  writeDecisions(
    session: SessionFacts,
    elementId: number,
    resolutions: readonly Resolution[],
  ): Promise<{ readonly blob: string }>;
  writeRoomType(session: SessionFacts, elementId: number, roomType: string): Promise<void>;
  launchRhvac(session: SessionFacts | null, path: string): Promise<void>;
  syncRhvac(
    session: SessionFacts,
    path: string,
    inserts: readonly { readonly zone: WorldZone; readonly room: WorldRoom }[],
  ): Promise<{ readonly text: string }>;
}

export interface TimedRead<A> {
  readonly value: A;
  readonly at: number;
  readonly basis: readonly string[];
  readonly bound: boolean;
}

export interface TakeoffFeed extends Feed {
  readonly basis?: readonly string[];
}

export interface VerbFailure {
  readonly kind: "busy" | "host";
  readonly verb: string;
  readonly message: string;
}

export interface VerbReceipt {
  readonly verb: string;
  readonly text: string;
  readonly at: number;
}

export interface StagedRoomEdit {
  readonly base: RoomEdit;
  readonly next: RoomEdit;
}

export interface AtlasPageState {
  readonly stageFilter: World["zones"][number]["stage"] | null;
  readonly level: string;
  readonly zoneKey: string | null;
  readonly cursor: string | null;
  readonly fieldsMode: "columns" | "panel";
}

export type AtlasRoomState = "call" | "unreviewed" | "data" | "synced";

export const ATLAS_ROOM_STATES: readonly AtlasRoomState[] = [
  "call",
  "unreviewed",
  "data",
  "synced",
];

export const ATLAS_ROOM_STATE_LABEL: Record<AtlasRoomState, string> = {
  call: "needs a call",
  unreviewed: "no Manual J",
  data: "data entered",
  synced: "in .r10",
};

export interface AtlasRow {
  readonly zone: WorldZone;
  readonly room: WorldRoom;
  readonly state: AtlasRoomState;
  readonly open: readonly string[];
}

export interface AdoptDraft {
  readonly region: CandidateRegion;
  readonly checked: boolean;
  readonly name: string;
  readonly systemTag: string;
}

export interface SyncPlan {
  readonly inScope: readonly WorldZone[];
  readonly blockedZones: readonly WorldZone[];
  readonly inserts: readonly { readonly zone: WorldZone; readonly room: WorldRoom }[];
  readonly untagged: number;
  readonly tags: readonly string[];
}

export const TAKEOFF_LINKS: Link[] = [
  {
    key: "world",
    joiner: "in",
    placeholder: "pick a world",
    needs: "a live world — start Revit with the Pe add-in, or start one from /instances",
    liveness: "attached",
  },
  {
    key: "rvt",
    parent: "world",
    joiner: "",
    placeholder: "no document",
    needs: "the document arrives with the bound world",
  },
  {
    key: "view",
    parent: "rvt",
    joiner: "from",
    placeholder: "pick a zoning plan",
    needs: "plan views with filled regions come from the bound model",
    dir: "read",
  },
  {
    key: "zones",
    parent: "rvt",
    joiner: "into",
    placeholder: "pick zones",
    needs: "zones come from adoption — stamp designer regions first",
    dir: "write",
    multi: true,
  },
  {
    key: "folder",
    joiner: "beside",
    placeholder: "pick a folder",
    needs: "a host-visible folder holding .r10 files — add one below",
  },
  {
    key: "r10",
    parent: "folder",
    joiner: "syncing",
    placeholder: "pick a .r10",
    needs: ".r10 files come from the bound folder",
    dir: "sync",
    liveness: "detached",
  },
];

const BINDINGS: Product = {
  key: "takeoffs",
  name: "takeoffs",
  links: TAKEOFF_LINKS,
  stages: [],
  panes: [],
};
const EMPTY_WORLD: World = { docName: "", r10Path: null, lanes: [], zones: [], systems: [] };

const timed = <A>(basis: readonly string[], read: () => Promise<A>) =>
  Effect.tryPromise({
    try: read,
    catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
  }).pipe(Effect.map((value): TimedRead<A> => ({ value, at: Date.now(), basis, bound: true })));

const unbound = <A>(value: A, basis: readonly string[] = []): TimedRead<A> => ({
  value,
  at: Date.now(),
  basis,
  bound: false,
});

const roomEdit = (room: WorldRoom): RoomEdit => ({
  name: room.name,
  type: room.type,
  ceilingFt: room.ceilingFt,
  people: room.data?.people,
  lightingW: room.data?.lightingW,
  equipSensible: room.data?.equipSensible,
  equipLatent: room.data?.equipLatent,
  ventilationCfm: room.data?.ventilationCfm,
});

const partitionInput = (zone: WorldZone, replayPath: string): PartitionArgs => ({
  replayPath,
  view: zone.zone.lane.view,
  levelFragment: zone.zone.lane.label,
  zoneName: zone.name,
  zoneGuid: zone.zone.guid,
  runId: `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
  loops: zone.zone.loops,
});

export function resultFeed<A>(
  result: AsyncResult.AsyncResult<TimedRead<A>, Error>,
  options: (value: A) => Feed["options"],
  fixture: boolean,
  live = false,
): TakeoffFeed {
  if (AsyncResult.isInitial(result))
    return { options: null, state: "loading", note: "not read yet" };
  if (AsyncResult.isFailure(result))
    return { options: null, state: "error", note: String(Cause.squash(result.cause)) };
  if (!result.value.bound)
    return {
      options: null,
      state: fixture ? "fixture" : "fresh",
      note: "unbound; no host read",
      basis: result.value.basis,
    };
  return {
    options: options(result.value.value),
    state: result.waiting ? "stale" : fixture ? "fixture" : live ? "live" : "fresh",
    at: result.value.at,
    basis: result.value.basis,
  };
}

export function atlasRoomState(room: WorldRoom, open: number): AtlasRoomState {
  if (open > 0 || (room.r10 && room.r10.lastSyncedSqft !== room.sqft)) return "call";
  if (room.r10) return "synced";
  if (room.data) return "data";
  return "unreviewed";
}

const atlasFacet = (row: AtlasRow, key: string): string | undefined => {
  if (key === "stage") return row.zone.stage;
  if (key === "state") return ATLAS_ROOM_STATE_LABEL[row.state];
  if (key === "type") return row.room.type;
  if (key === "r10")
    return !row.room.r10
      ? "not exported"
      : row.room.r10.lastSyncedSqft === row.room.sqft
        ? "clean"
        : "drift";
  return undefined;
};

const atlasSortValue = (
  row: AtlasRow,
  key: string,
  fieldsMode: AtlasPageState["fieldsMode"],
): string | number | undefined => {
  if (key === "stage") return STAGE_ORDER.indexOf(row.zone.stage);
  if (key === "state") return ATLAS_ROOM_STATES.indexOf(row.state);
  if (key === "zone") return row.zone.zone.key;
  if (key === "name") return row.room.name;
  if (key === "type") return row.room.type;
  if (key === "sqft") return row.room.sqft;
  if (key === "flags") return row.open.length;
  if (key === "r10") return atlasFacet(row, key) === "drift" ? 0 : row.room.r10 ? 6 : 5;
  if (fieldsMode === "panel") return undefined;
  if (key === "ceil") return row.room.ceilingFt;
  if (key === "people") return row.room.data?.people ?? 0;
  if (key === "lightingW") return row.room.data?.lightingW ?? 0;
  if (key === "equipSensible") return row.room.data?.equipSensible ?? 0;
  if (key === "equipLatent") return row.room.data?.equipLatent ?? 0;
  if (key === "ventilationCfm") return row.room.data?.ventilationCfm ?? 0;
  return undefined;
};

const compare = (a: string | number | undefined, b: string | number | undefined): number => {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
};

export function createTakeoffStore(deps: {
  host: TakeoffHost;
  sessions: SessionSource;
  search: SearchPort;
  registry: AtomRegistry.AtomRegistry;
}) {
  const registry = deps.registry;
  const inspector = inspectAtomRegistry(registry);
  const write = <A>(verb: string, key: string, run: () => A): A => {
    inspector.note({ verb, key });
    return run();
  };
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.withLabel("takeoffs/runtime"));
  let busyTimer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  let currentHover = "";
  let focusedZone = "";
  let selectedRoom = "";
  const stagedIds = new Set<string>();

  const searchAtom = Atom.make<TakeoffSearch>(EMPTY_TAKEOFF_SEARCH).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search"),
  );
  const targetAtom = Atom.make((get) => get(searchAtom).target).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/target"),
  );
  const sourceAtom = Atom.make((get) => get(searchAtom).source).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/source"),
  );
  const viewAtom = Atom.make((get) => get(searchAtom).view).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/view"),
  );
  const zonesAtom = Atom.make((get) => get(searchAtom).zones).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/zones"),
  );
  const dirAtom = Atom.make((get) => get(searchAtom).dir).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/dir"),
  );
  const r10PathAtom = Atom.make((get) => get(searchAtom).r10).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/r10"),
  );
  const stageAtom = Atom.make((get) => get(searchAtom).stage).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/stage"),
  );
  const recentDirsAtom = Atom.make<readonly string[]>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/persisted/recent-dirs"),
  );
  const actionsLogAtom = Atom.make<string[]>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/actions"),
  );
  const busyAtom = Atom.make<{ id: string; seconds: number } | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/verb/busy"),
  );
  const failureAtom = Atom.make<VerbFailure | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/verb/failure"),
  );
  const receiptAtom = Atom.make<VerbReceipt | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/verb/receipt"),
  );
  const atlasPageAtom = Atom.make<AtlasPageState>({
    stageFilter: null,
    level: "",
    zoneKey: null,
    cursor: null,
    fieldsMode: "columns",
  }).pipe(Atom.withLabel("takeoffs/page/atlas"));
  const atlasTableStateAtom = Atom.make<MasterTableState>({
    filters: {},
    sorts: [],
    query: "",
  }).pipe(Atom.withLabel("takeoffs/page/atlas-table"));
  const replaysAtom = Atom.make<Readonly<Record<string, string>>>({}).pipe(
    Atom.withLabel("takeoffs/page/replays"),
  );
  const panelAtom = Atom.make<"adopt" | "sync" | null>(null).pipe(
    Atom.withLabel("takeoffs/page/panel"),
  );
  const adoptPatchesAtom = Atom.make<Readonly<Record<number, Partial<AdoptDraft>>>>({}).pipe(
    Atom.withLabel("takeoffs/page/adopt-patches"),
  );
  const hoveredAtom = Atom.family((id: string) =>
    Atom.make(false).pipe(Atom.withLabel(`takeoffs/entity/${id}/hovered`)),
  );
  const selectedAtom = Atom.family((id: string) =>
    Atom.make(false).pipe(Atom.withLabel(`takeoffs/entity/${id}/selected`)),
  );
  const boundAtom = Atom.family((id: string) =>
    Atom.make(false).pipe(Atom.withLabel(`takeoffs/entity/${id}/url-bound`)),
  );
  const decidedAtom = Atom.family((id: string) =>
    Atom.make<Readonly<Record<string, "accept" | "dismiss">>>({}).pipe(
      Atom.withLabel(`takeoffs/entity/${id}/decided`),
    ),
  );
  const stagedAtom = Atom.family((id: string) =>
    Atom.make<StagedRoomEdit | null>(null).pipe(Atom.withLabel(`takeoffs/entity/${id}/staged`)),
  );

  const sessionsSource = runtime
    .atom(() => timed(["sessions"], () => deps.sessions.list()))
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/sessions"));
  const sessionsResult = runtimeFactory
    .withReactivity(["sessions"])(sessionsSource)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/sessions"));
  const activeDocumentSource = runtime
    .atom((get) => {
      const target = get(targetAtom);
      return Effect.gen(function* () {
        const read = yield* get.result(sessionsResult, { suspendOnWaiting: true });
        const resolution = resolveTarget(read.value, target);
        if (resolution.kind !== "resolved") return unbound<ActiveDocument | null>(null, [target]);
        const document = yield* timed([resolution.session.sessionId], () =>
          deps.sessions.activeDocument(resolution.session),
        );
        return document;
      });
    })
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/active-document"));
  const activeDocumentResult = runtimeFactory
    .withReactivity(["active-document"])(activeDocumentSource)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/active-document"));
  const snapshotSource = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        if (!document.value) return unbound<TakeoffSnapshot | null>(null, document.basis);
        return yield* timed([document.value.session.sessionId, document.value.title], () =>
          deps.host.readSnapshot(document.value!.session, document.value!),
        );
      }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/snapshot"));
  const snapshotResult = runtimeFactory
    .withReactivity(["snapshot"])(
      Atom.swr(snapshotSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/snapshot"));
  const candidatesSource = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        const view = get(viewAtom);
        if (!document.value || !view) return unbound<CandidateRegion[]>([], document.basis);
        return yield* timed([document.value.session.sessionId, view], () =>
          deps.host.readCandidates(document.value!.session, view),
        );
      }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/candidates"));
  const candidatesResult = runtimeFactory
    .withReactivity(["candidates"])(
      Atom.swr(candidatesSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/candidates"));
  const adoptRowsAtom = Atom.make((get): readonly AdoptDraft[] | null => {
    const result = get(candidatesResult);
    if (!AsyncResult.isSuccess(result) || !result.value.bound) return null;
    const patches = get(adoptPatchesAtom);
    return result.value.value.map((region) => {
      const meta = readZoneMeta(region.blob);
      return {
        region,
        checked: region.role === "zoning-region",
        name: meta.name || region.typeName,
        systemTag: meta.systemTag,
        ...patches[region.elementId],
      };
    });
  }).pipe(Atom.withLabel("takeoffs/page/adopt-rows"));
  const foldersSource = runtime
    .atom((get) =>
      Effect.succeed({
        value: get(recentDirsAtom),
        at: Date.now(),
        basis: ["browser"],
        bound: true,
      } satisfies TimedRead<readonly string[]>),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/folders"));
  const foldersResult = runtimeFactory
    .withReactivity(["folders"])(foldersSource)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/folders"));
  const listingSource = runtime
    .atom((get) => {
      const dir = get(dirAtom);
      return dir
        ? timed([dir], () => deps.host.listRhvac(dir))
        : Effect.succeed(unbound<RhvacFile[]>([], []));
    })
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/rhvac-list"));
  const listingResult = runtimeFactory
    .withReactivity(["rhvac-list"])(
      Atom.swr(listingSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/rhvac-list"));
  const r10Source = runtime
    .atom((get) => {
      const path = get(r10PathAtom);
      return Effect.gen(function* () {
        const files = yield* get.result(listingResult, { suspendOnWaiting: true });
        if (!path) return unbound<unknown>(null, files.basis);
        if (!files.value.some((file) => file.path === path))
          return yield* Effect.fail(Error(`unknown .r10 ${path}`));
        return yield* timed([path], () => deps.host.openRhvac(path));
      });
    })
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/r10-open"));
  const r10Result = runtimeFactory
    .withReactivity(["rhvac-open"])(
      Atom.swr(r10Source, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/r10-open"));

  const sessionsFeed = Atom.make((get) =>
    resultFeed(
      get(sessionsResult),
      (items) =>
        items.map((session) => ({
          id: mintSelector(session, items),
          label: session.activeDocumentTitle ?? `Revit ${session.processId}`,
        })),
      deps.host.fixture,
      true,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/world"));
  const documentFeed = Atom.make((get) =>
    resultFeed(
      get(activeDocumentResult),
      (document) => (document ? [{ id: document.title, label: document.title }] : []),
      deps.host.fixture,
      true,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/rvt"));
  const viewFeed = Atom.make((get) =>
    resultFeed(
      get(snapshotResult),
      (snapshot) =>
        snapshot?.views.map((view) => ({ id: view.name, label: view.name, sub: view.level })) ?? [],
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/view"));
  const zonesFeed = Atom.make((get) =>
    resultFeed(
      get(snapshotResult),
      (snapshot) =>
        snapshot?.world.zones.map((zone) => ({ id: zone.zone.guid, label: zone.name })) ?? [],
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/zones"));
  const folderFeed = Atom.make((get) =>
    resultFeed(
      get(foldersResult),
      (dirs) => dirs.map((dir) => ({ id: dir, label: dir })),
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/folder"));
  const r10Feed = Atom.make((get) =>
    resultFeed(
      get(listingResult),
      (files) => files.map((file) => ({ id: file.path, label: file.name })),
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/r10"));
  const authorityWorldAtom = Atom.make((get): World => {
    const result = get(snapshotResult);
    const snapshot = AsyncResult.isSuccess(result)
      ? result.value.value
      : AsyncResult.isFailure(result)
        ? Option.getOrUndefined(result.previousSuccess)?.value.value
        : null;
    if (!snapshot) return EMPTY_WORLD;
    if (!snapshot.status) return snapshot.world;
    const opened = get(r10Result);
    const r10 = AsyncResult.isSuccess(opened)
      ? opened.value.bound
        ? opened.value.value
        : null
      : AsyncResult.isFailure(opened)
        ? Option.getOrUndefined(opened.previousSuccess)?.value.value
        : null;
    return buildLiveWorld({
      ...snapshot,
      status: snapshot.status,
      overlay: emptyOverlay(),
      r10Path: get(r10PathAtom) || null,
      r10: r10 as Parameters<typeof buildLiveWorld>[0]["r10"],
    });
  }).pipe(Atom.withLabel("takeoffs/world/authority"));
  const worldAtom = Atom.make((get): World => {
    const authority = get(authorityWorldAtom);
    return {
      ...authority,
      lanes: authority.lanes.map((lane) => ({
        ...lane,
        replayPath: get(replaysAtom)[lane.label] ?? lane.replayPath,
      })),
      zones: authority.zones.map((zone) => ({
        ...zone,
        zone: {
          ...zone.zone,
          lane: {
            ...zone.zone.lane,
            replayPath: get(replaysAtom)[zone.zone.lane.label] ?? zone.zone.lane.replayPath,
          },
        },
        rooms: zone.rooms.map((room) => applyEdit(room, get(stagedAtom(room.guid))?.next)),
      })),
    };
  }).pipe(Atom.withLabel("takeoffs/world"));
  const roomsByIdAtom = Atom.make(
    (get) =>
      new Map(
        get(authorityWorldAtom)
          .zones.flatMap((zone) => zone.rooms)
          .map((room) => [room.guid, room] as const),
      ),
  ).pipe(Atom.withLabel("takeoffs/rooms-by-id"));
  const decisionsAtom = Atom.make((get) =>
    Object.fromEntries(
      [...get(roomsByIdAtom).keys()].flatMap((id) =>
        Object.entries(get(decidedAtom(id))).map(([flag, verdict]) => [`${id}::${flag}`, verdict]),
      ),
    ),
  ).pipe(Atom.withLabel("takeoffs/page/decisions"));
  const atlasRowsAtom = Atom.make((get): readonly AtlasRow[] => {
    const page = get(atlasPageAtom);
    const decisions = get(decisionsAtom);
    const world = get(worldAtom);
    const selected = page.zoneKey
      ? world.zones.find((zone) => zone.zone.key === page.zoneKey)
      : undefined;
    const zones = selected
      ? [selected]
      : world.zones.filter((zone) => page.stageFilter === null || zone.stage === page.stageFilter);
    return zones.flatMap((zone) =>
      zone.rooms.map((room) => {
        const open = room.flags.filter((flag) => decisions[`${room.guid}::${flag}`] === undefined);
        return { zone, room, open, state: atlasRoomState(room, open.length) };
      }),
    );
  }).pipe(Atom.withLabel("takeoffs/page/atlas-rows"));
  const visibleRowsAtom = Atom.make((get): readonly string[] => {
    const page = get(atlasPageAtom);
    const state = get(atlasTableStateAtom);
    const query = state.query.trim().toLowerCase();
    return get(atlasRowsAtom)
      .filter(
        (row) =>
          (!query ||
            [row.zone.zone.key, row.room.name, row.room.type].some((value) =>
              value.toLowerCase().includes(query),
            )) &&
          Object.entries(state.filters).every(([key, value]) =>
            key === "flags"
              ? value === "any"
                ? row.open.length > 0
                : value === "none"
                  ? row.open.length === 0
                  : row.open.includes(value)
              : atlasFacet(row, key) === value,
          ),
      )
      .sort((left, right) => {
        for (const sort of state.sorts) {
          const order = compare(
            atlasSortValue(left, sort.key, page.fieldsMode),
            atlasSortValue(right, sort.key, page.fieldsMode),
          );
          if (order !== 0) return sort.dir === "desc" ? -order : order;
        }
        return 0;
      })
      .map((row) => row.room.guid);
  }).pipe(Atom.withLabel("takeoffs/page/atlas-visible-rows"));
  const syncPlanAtom = Atom.make((get): SyncPlan => {
    const selected = new Set(get(zonesAtom));
    const inScope = get(worldAtom).zones.filter(
      (zone) => selected.size === 0 || selected.has(zone.zone.guid),
    );
    const blockedZones = inScope.filter(
      (zone) =>
        zone.driftSqft > 0 ||
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
      blockedZones,
      inserts,
      untagged: inserts.filter(({ zone }) => zone.tags.length === 0).length,
      tags: [...new Set(inserts.flatMap(({ zone }) => zone.tags))],
    };
  }).pipe(Atom.withLabel("takeoffs/page/sync-plan"));
  const entityAtom = Atom.family((id: string) =>
    Atom.make((get) => {
      const authority = get(roomsByIdAtom).get(id);
      const staged = get(stagedAtom(id));
      return {
        hovered: get(hoveredAtom(id)),
        selected: get(selectedAtom(id)),
        bound: get(boundAtom(id)),
        decided: get(decidedAtom(id)),
        staged,
        dirty: staged !== null,
        conflict:
          staged !== null &&
          authority !== undefined &&
          JSON.stringify(staged.base) !== JSON.stringify(roomEdit(authority)),
      };
    }).pipe(Atom.withLabel(`takeoffs/entity/${id}`)),
  );

  const invalidateAtom = runtime
    .fn((keys: readonly string[]) => Reactivity.invalidate(keys))
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/invalidate"));
  const adoptMutation = runtime
    .fn((input: { readonly view: string; readonly items: readonly AdoptItem[] }, get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        if (!document.value) return yield* Effect.fail(Error("no document bound"));
        const receipt = yield* Effect.tryPromise({
          try: () => deps.host.adopt(document.value!.session, input),
          catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
        });
        yield* Reactivity.invalidate(["snapshot", "candidates"]);
        return receipt;
      }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/verb/adopt"));

  const log = (verb: string, text: string) =>
    write(verb, "actions", () =>
      registry.update(actionsLogAtom, (items) => [...items, text].slice(-20)),
    );
  const settle = <A>(atom: Atom.Atom<AsyncResult.AsyncResult<A, Error>>) => {
    registry.get(atom);
    return Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }));
  };
  const runVerb = async <A>(id: string, work: () => Promise<A>): Promise<A> => {
    if (inFlight) {
      const failure = {
        kind: "busy",
        verb: id,
        message: `${id} refused; another verb is running`,
      } as const;
      write(id, "failure", () => registry.set(failureAtom, failure));
      throw Error(failure.message);
    }
    inFlight = true;
    write(id, "failure", () => registry.set(failureAtom, null));
    write(id, "busy", () => registry.set(busyAtom, { id, seconds: 0 }));
    const started = Date.now();
    busyTimer = setInterval(
      () =>
        write(id, "busy", () =>
          registry.set(busyAtom, { id, seconds: Math.floor((Date.now() - started) / 1000) }),
        ),
      250,
    );
    try {
      const value = await work();
      const text =
        typeof value === "string"
          ? value
          : typeof value === "object" &&
              value !== null &&
              "text" in value &&
              typeof value.text === "string"
            ? value.text
            : id;
      write(id, "receipt", () => registry.set(receiptAtom, { verb: id, text, at: Date.now() }));
      log(id, `${id} succeeded`);
      return value;
    } catch (cause) {
      const failure = {
        kind: "host",
        verb: id,
        message: cause instanceof Error ? cause.message : String(cause),
      } as const;
      write(id, "failure", () => registry.set(failureAtom, failure));
      log(id, `${id} failed`);
      throw cause;
    } finally {
      if (busyTimer) clearInterval(busyTimer);
      busyTimer = undefined;
      inFlight = false;
      write(id, "busy", () => registry.set(busyAtom, null));
    }
  };
  const clearStaging = () => {
    for (const id of stagedIds)
      write("clear-staging", `entity/${id}/staged`, () => registry.set(stagedAtom(id), null));
    stagedIds.clear();
  };
  const stageRoom = (id: string, patch: RoomEdit) => {
    const authority = registry.get(roomsByIdAtom).get(id);
    if (!authority) throw Error(`unknown room ${id}`);
    const staged = registry.get(stagedAtom(id));
    const base = staged?.base ?? roomEdit(authority);
    const next = { ...(staged?.next ?? base), ...patch };
    write("stage-room", `entity/${id}/staged`, () => registry.set(stagedAtom(id), { base, next }));
    stagedIds.add(id);
    return authority;
  };
  const commitRoomField = (id: string, patch: RoomEdit) => {
    const staged = registry.get(stagedAtom(id));
    if (!staged) return;
    const base = { ...staged.base, ...patch };
    const next = { ...staged.next, ...patch };
    if (JSON.stringify(base) === JSON.stringify(next)) {
      write("commit-room", `entity/${id}/staged`, () => registry.set(stagedAtom(id), null));
      stagedIds.delete(id);
    } else
      write("commit-room", `entity/${id}/staged`, () =>
        registry.set(stagedAtom(id), { base, next }),
      );
  };
  const activeSession = async () => {
    const document = await settle(activeDocumentResult);
    if (!document.value) throw Error("no document bound");
    return document.value.session;
  };
  const setSearch = (next: TakeoffSearch) => {
    const previous = registry.get(searchAtom);
    const before = new Set(previous.zones);
    const after = new Set(next.zones);
    Atom.batch(() => {
      write("set-search", "search", () => registry.set(searchAtom, next));
      for (const id of new Set([...before, ...after]))
        if (before.has(id) !== after.has(id))
          write("set-search", `entity/${id}/url-bound`, () =>
            registry.set(boundAtom(id), after.has(id)),
          );
    });
    if (previous.target !== next.target || previous.view !== next.view) clearStaging();
  };
  const pick = (key: Link["key"], id: string) => {
    const current = registry.get(searchAtom);
    const bound: Bound = {
      world: current.target || null,
      rvt: null,
      view: current.view || null,
      folder: current.dir || null,
      r10: current.r10 || null,
    };
    const multi: Multi = { zones: new Set(current.zones) };
    const link = TAKEOFF_LINKS.find((candidate) => candidate.key === key);
    if (!link) throw Error(`unknown takeoff binding ${key}`);
    const next = pickInto(BINDINGS, bound, multi, link, id);
    deps.search.patch({
      target: next.bound.world ?? "",
      view: next.bound.view ?? "",
      zones: [...(next.multi.zones ?? [])],
      dir: next.bound.folder ?? "",
      r10: next.bound.r10 ?? "",
    });
  };

  const unsubscribe = deps.sessions.subscribe((event) => {
    if (event.kind === "sessionsChanged") {
      log("host-event", `push ${event.kind} ${event.sessionId}`);
      write("host-event", "invalidate/sessions", () => registry.set(invalidateAtom, ["sessions"]));
      return;
    }
    const document = registry.get(activeDocumentResult);
    const current = AsyncResult.isSuccess(document)
      ? document.value.value?.session.sessionId
      : null;
    if (current !== event.sessionId) return;
    log("host-event", `push ${event.kind} ${event.sessionId}`);
    write("host-event", "invalidate/active-document", () =>
      registry.set(invalidateAtom, ["active-document"]),
    );
  });

  const feeds = {
    world: sessionsFeed,
    rvt: documentFeed,
    view: viewFeed,
    zones: zonesFeed,
    folder: folderFeed,
    r10: r10Feed,
  };
  const actions = {
    setSearch,
    patchSearch(patch: Partial<TakeoffSearch>) {
      deps.search.patch(patch);
    },
    setBindings(patch: {
      readonly stage?: string;
      readonly bound?: Bound;
      readonly multi?: Multi;
    }) {
      const current = registry.get(searchAtom);
      deps.search.patch({
        ...(patch.stage ? { stage: patch.stage as TakeoffStage } : {}),
        ...(patch.bound
          ? {
              ...(current.source === "live" && patch.bound.world !== current.target
                ? { target: patch.bound.world ?? "" }
                : {}),
              view: patch.bound.view ?? "",
              dir: patch.bound.folder ?? "",
              r10: patch.bound.r10 ?? "",
            }
          : {}),
        ...(patch.multi ? { zones: [...(patch.multi.zones ?? [])] } : {}),
      });
    },
    pick,
    settle,
    invalidate: (keys: readonly string[]) =>
      write("invalidate", keys.join(","), () => registry.set(invalidateAtom, keys)),
    rememberDir(dir: string) {
      const value = dir.trim();
      if (!value) return;
      write("remember-dir", "persisted/recent-dirs", () =>
        registry.update(recentDirsAtom, (dirs) =>
          [value, ...dirs.filter((item) => item !== value)].slice(0, 8),
        ),
      );
    },
    hover(id: string) {
      if (id === currentHover) return;
      Atom.batch(() => {
        if (currentHover)
          write("hover", `entity/${currentHover}/hovered`, () =>
            registry.set(hoveredAtom(currentHover), false),
          );
        currentHover = id;
        if (id) write("hover", `entity/${id}/hovered`, () => registry.set(hoveredAtom(id), true));
      });
    },
    focusZone(id: string) {
      Atom.batch(() => {
        if (focusedZone)
          write("focus-zone", `entity/${focusedZone}/selected`, () =>
            registry.set(selectedAtom(focusedZone), false),
          );
        focusedZone = id;
        if (id)
          write("focus-zone", `entity/${id}/selected`, () => registry.set(selectedAtom(id), true));
      });
    },
    selectRoom(id: string) {
      Atom.batch(() => {
        if (selectedRoom)
          write("select-room", `entity/${selectedRoom}/selected`, () =>
            registry.set(selectedAtom(selectedRoom), false),
          );
        selectedRoom = id;
        if (id)
          write("select-room", `entity/${id}/selected`, () => registry.set(selectedAtom(id), true));
      });
    },
    setAtlasPage(patch: Partial<AtlasPageState>) {
      write("set-atlas-page", "page/atlas", () =>
        registry.update(atlasPageAtom, (page) => ({ ...page, ...patch })),
      );
    },
    setSort(sorts: MasterTableState["sorts"]) {
      write("set-sort", "page/atlas-table/sorts", () =>
        registry.update(atlasTableStateAtom, (state) => ({ ...state, sorts })),
      );
    },
    setTableState(state: MasterTableState) {
      write("set-table-state", "page/atlas-table", () => registry.set(atlasTableStateAtom, state));
    },
    openPanel(panel: "adopt" | "sync" | null) {
      write("open-panel", "page/panel", () => registry.set(panelAtom, panel));
    },
    clearFailure() {
      write("clear-failure", "failure", () => registry.set(failureAtom, null));
    },
    patchAdopt(elementId: number, patch: Partial<AdoptDraft>) {
      write("patch-adopt", "page/adopt-patches", () =>
        registry.update(adoptPatchesAtom, (patches) => ({
          ...patches,
          [elementId]: { ...patches[elementId], ...patch },
        })),
      );
    },
    decide(id: string, flag: string, verdict: "accept" | "dismiss") {
      write("decide", `entity/${id}/decided`, () =>
        registry.update(decidedAtom(id), (decisions) => ({ ...decisions, [flag]: verdict })),
      );
    },
    stage(id: string, base: RoomEdit, next: RoomEdit) {
      const staged = JSON.stringify(base) === JSON.stringify(next) ? null : { base, next };
      write("stage", `entity/${id}/staged`, () => registry.set(stagedAtom(id), staged));
      if (staged) stagedIds.add(id);
      else stagedIds.delete(id);
    },
    patchRoom(id: string, patch: RoomEdit) {
      const room = stageRoom(id, patch);
      if (deps.host.fixture || patch.type === undefined || room.elementId === null) return;
      void runVerb("room-type", async () => {
        const session = await activeSession();
        await deps.host.writeRoomType(session, room.elementId!, patch.type!);
        commitRoomField(id, { type: patch.type });
        write("room-type", "invalidate/snapshot", () => registry.set(invalidateAtom, ["snapshot"]));
      }).catch(() => undefined);
    },
    decideRoom(room: WorldRoom, flag: string, verdict: "accept" | "dismiss") {
      write("decision", `entity/${room.guid}/decided`, () =>
        registry.update(decidedAtom(room.guid), (decisions) => ({ ...decisions, [flag]: verdict })),
      );
      if (deps.host.fixture) return;
      void runVerb("decision", async () => {
        if (room.elementId === null) throw Error(`room ${room.name} has no Room Region home`);
        const session = await activeSession();
        const next: Resolution = {
          subject: room.provenance.sourceRoomId,
          flag,
          verb: verdict,
          at: new Date().toISOString(),
          runId: room.provenance.runId,
        };
        await deps.host.writeDecisions(
          session,
          room.elementId,
          upsertResolution(room.decisions, next),
        );
        write("decision", "invalidate/snapshot", () => registry.set(invalidateAtom, ["snapshot"]));
      }).catch(() => undefined);
    },
    capture(lane: Pick<WorldLane, "view" | "label">) {
      return runVerb("capture", async () => {
        const session = await activeSession();
        const result = await deps.host.capture(session, lane);
        write("capture", "page/replays", () =>
          registry.update(replaysAtom, (replays) => ({
            ...replays,
            [lane.label]: result.replayPath,
          })),
        );
        return { ...result, text: `captured ${lane.label}: ${result.rooms} rooms` };
      });
    },
    partition(zone: WorldZone) {
      return runVerb("partition", async () => {
        const replayPath = registry.get(replaysAtom)[zone.zone.lane.label];
        if (!replayPath) throw Error(`capture ${zone.zone.lane.label} first`);
        const session = await activeSession();
        const result = await deps.host.partition(session, partitionInput(zone, replayPath));
        write("partition", "invalidate/snapshot", () => registry.set(invalidateAtom, ["snapshot"]));
        return { ...result, text: `partitioned ${zone.zone.key}` };
      });
    },
    refresh() {
      write("refresh", "invalidate/snapshot", () => registry.set(invalidateAtom, ["snapshot"]));
      return settle(snapshotResult);
    },
    launchRhvac() {
      return runVerb("launch", async () => {
        const path = registry.get(r10PathAtom);
        if (!path) throw Error("no .r10 bound");
        const document = await settle(activeDocumentResult);
        await deps.host.launchRhvac(document.value?.session ?? null, path);
        return `opened ${path} in RHVAC`;
      });
    },
    syncRhvac() {
      return runVerb("sync", async () => {
        const path = registry.get(r10PathAtom);
        if (!path) throw Error("no .r10 bound");
        const plan = registry.get(syncPlanAtom);
        if (plan.inserts.length === 0) throw Error("no rooms are eligible to sync");
        if (plan.untagged > 0) throw Error(`${plan.untagged} eligible rooms have no system tag`);
        const session = await activeSession();
        const result = await deps.host.syncRhvac(session, path, plan.inserts);
        clearStaging();
        write("sync", "page/panel", () => registry.set(panelAtom, null));
        write("sync", "invalidate/snapshot,rhvac-open", () =>
          registry.set(invalidateAtom, ["snapshot", "rhvac-open"]),
        );
        return result;
      });
    },
    adopt(input: { readonly view: string; readonly items: readonly AdoptItem[] }) {
      return runVerb("adopt", async () => {
        write("adopt", "verb/adopt", () => registry.set(adoptMutation, input));
        return settle(adoptMutation);
      });
    },
    adoptSelected() {
      const view = registry.get(viewAtom);
      const rows = registry.get(adoptRowsAtom)?.filter((row) => row.checked) ?? [];
      return actions
        .adopt({
          view,
          items: rows.map((row) => ({
            elementId: row.region.elementId,
            name: row.name,
            systemTag: row.systemTag,
          })),
        })
        .then((result) => {
          write("adopt", "page/adopt-patches", () => registry.set(adoptPatchesAtom, {}));
          write("adopt", "page/panel", () => registry.set(panelAtom, null));
          return result;
        });
    },
  };

  const store = {
    registry,
    inspector,
    atoms: {
      registry,
      search: searchAtom,
      target: targetAtom,
      source: sourceAtom,
      view: viewAtom,
      zones: zonesAtom,
      dir: dirAtom,
      r10Path: r10PathAtom,
      stage: stageAtom,
      world: worldAtom,
      atlasPage: atlasPageAtom,
      atlasTableState: atlasTableStateAtom,
      atlasRows: atlasRowsAtom,
      visibleRows: visibleRowsAtom,
      decisions: decisionsAtom,
      panel: panelAtom,
      syncPlan: syncPlanAtom,
      sessions: sessionsResult,
      activeDocument: activeDocumentResult,
      snapshot: snapshotResult,
      candidates: candidatesResult,
      adoptRows: adoptRowsAtom,
      listing: listingResult,
      r10: r10Result,
      entity: entityAtom,
      busy: busyAtom,
      failure: failureAtom,
      receipt: receiptAtom,
    },
    actions,
    feeds,
    inspect() {
      return {
        ...inspector.snapshot(),
        url: registry.get(searchAtom),
        persisted: { recentDirs: registry.get(recentDirsAtom) },
        page: {
          atlas: registry.get(atlasPageAtom),
          table: registry.get(atlasTableStateAtom),
          visibleRows: registry.get(visibleRowsAtom),
          hover: currentHover,
          staged: [...stagedIds],
          busy: registry.get(busyAtom),
          failure: registry.get(failureAtom),
          receipt: registry.get(receiptAtom),
        },
        feeds: Object.fromEntries(
          Object.entries(feeds).map(([key, atom]) => [key, registry.get(atom)]),
        ),
        actions: registry.get(actionsLogAtom),
      };
    },
    subscribe: (cb: () => void) => inspector.subscribe(cb),
    note: (cause: { verb: string; key: string }) => inspector.note(cause),
    refresh: (id: string) => inspector.refresh(id),
    set: (id: string, value: string) => inspector.set(id, value),
    dispose() {
      unsubscribe();
      if (busyTimer) clearInterval(busyTimer);
      inspector.dispose();
    },
  };
  return store satisfies InspectableAtomStore;
}

export type TakeoffStore = ReturnType<typeof createTakeoffStore>;
