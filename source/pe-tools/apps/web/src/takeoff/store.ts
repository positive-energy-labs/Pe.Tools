import { Cause, Effect, Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import {
  takeoffsRouteState,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type StagedRoomEdit,
  type TakeoffSnapshot,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import { mintSelector, resolveTarget, type SessionFacts } from "#/host/target";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  feed,
  hostRead,
  unbound,
  type Feed,
  type Scope,
  type Slice,
  type TimedRead,
} from "#/state/route-store";
import type {
  AdoptItem,
  PartitionArgs,
} from "../../../../packages/mcps/src/shared/takeoff-ops.ts";
import {
  upsertResolution,
  type CandidateRegion,
  type PartitionRun,
  type Resolution,
} from "#/takeoff/model";
import {
  applyEdit,
  readZoneMeta,
  STAGE_ORDER,
  type RoomEdit,
  type World,
  type WorldLane,
  type WorldRoom,
  type WorldZone,
} from "#/takeoff/world";
import { type Bound, type Link, type Multi } from "#/targeting/model";

export type TakeoffStage = "adopt" | "audit" | "sync";

export interface TakeoffSearch {
  readonly source: "live" | "fixture";
  readonly views: readonly string[];
  readonly zones: readonly string[];
  readonly dir: string;
  readonly r10: string;
  readonly stage: TakeoffStage;
}

export const EMPTY_TAKEOFF_SEARCH: TakeoffSearch = {
  source: "live",
  views: [],
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

export interface TakeoffSessionFacts extends SessionFacts {
  readonly year?: string;
}

export interface ActiveDocument {
  readonly session: TakeoffSessionFacts;
  readonly title: string;
}

export interface SessionSource {
  list(): Promise<TakeoffSessionFacts[]>;
  activeDocument(session: TakeoffSessionFacts): Promise<ActiveDocument>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface RhvacFile {
  readonly path: string;
  readonly name: string;
}

export interface TakeoffHost {
  readonly fixture: boolean;
  listRecentDocuments?(year?: string): Promise<readonly RecentDocument[]>;
  openDocument?(input: {
    readonly path: string;
    readonly id: string;
    readonly conflictPolicy?: "keep";
  }): Promise<void>;
  readSnapshot(
    session: SessionFacts,
    document: ActiveDocument,
    write: (snapshot: TakeoffSnapshot) => Promise<unknown>,
  ): Promise<TakeoffSnapshot>;
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

export interface AtlasPageState {
  readonly stageFilter: World["zones"][number]["stage"] | null;
  readonly level: string;
  readonly zoneKey: string | null;
  readonly cursor: string | null;
  readonly fieldsMode: "columns" | "panel";
  readonly planOpen: boolean;
  readonly statsOpen: boolean;
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
  readonly view: string;
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
    key: "views",
    parent: "rvt",
    joiner: "from",
    placeholder: "pick zoning plans",
    needs: "plan views with filled regions come from the bound model",
    dir: "read",
    multi: true,
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

const EMPTY_WORLD: World = { docName: "", r10Path: null, lanes: [], zones: [], systems: [] };

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

export function atlasRoomState(room: WorldRoom, open: number): AtlasRoomState {
  if (open > 0 || (room.r10 && room.r10.lastSyncedSqft !== room.sqft)) return "call";
  if (room.r10) return "synced";
  if (room.data) return "data";
  return "unreviewed";
}

interface AtlasColumnSemantics {
  readonly sort: (row: AtlasRow) => string | number;
  readonly facet?: (row: AtlasRow) => string;
  readonly match?: (row: AtlasRow, value: string) => boolean;
}

export const ATLAS_COLUMN_SEMANTICS = {
  stage: {
    sort: (row) => STAGE_ORDER.indexOf(row.zone.stage),
    facet: (row) => row.zone.stage,
  },
  state: {
    sort: (row) => ATLAS_ROOM_STATES.indexOf(row.state),
    facet: (row) => ATLAS_ROOM_STATE_LABEL[row.state],
  },
  zone: { sort: (row) => row.zone.zone.key },
  name: { sort: (row) => row.room.name },
  type: { sort: (row) => row.room.type, facet: (row) => row.room.type },
  sqft: { sort: (row) => row.room.sqft },
  ceil: { sort: (row) => row.room.ceilingFt },
  people: { sort: (row) => row.room.data?.people ?? 0 },
  lightingW: { sort: (row) => row.room.data?.lightingW ?? 0 },
  equipSensible: { sort: (row) => row.room.data?.equipSensible ?? 0 },
  equipLatent: { sort: (row) => row.room.data?.equipLatent ?? 0 },
  ventilationCfm: { sort: (row) => row.room.data?.ventilationCfm ?? 0 },
  flags: {
    sort: (row) => row.open.length,
    match: (row, value) =>
      value === "any"
        ? row.open.length > 0
        : value === "none"
          ? row.open.length === 0
          : row.open.includes(value),
  },
  r10: {
    sort: (row) => (!row.room.r10 ? 5 : row.room.r10.lastSyncedSqft === row.room.sqft ? 6 : 0),
    facet: (row) =>
      !row.room.r10
        ? "not exported"
        : row.room.r10.lastSyncedSqft === row.room.sqft
          ? "clean"
          : "drift",
  },
} as const satisfies Readonly<Record<string, AtlasColumnSemantics>>;

type AtlasColumnKey = keyof typeof ATLAS_COLUMN_SEMANTICS;
const atlasColumnSemantics = (key: string): AtlasColumnSemantics | undefined =>
  ATLAS_COLUMN_SEMANTICS[key as AtlasColumnKey];

const atlasFacet = (row: AtlasRow, key: string): string | undefined =>
  atlasColumnSemantics(key)?.facet?.(row);

const atlasSortValue = (
  row: AtlasRow,
  key: string,
  fieldsMode: AtlasPageState["fieldsMode"],
): string | number | undefined => {
  const semantics = atlasColumnSemantics(key);
  if (!semantics) return undefined;
  if (
    fieldsMode === "panel" &&
    ["ceil", "people", "lightingW", "equipSensible", "equipLatent", "ventilationCfm"].includes(key)
  )
    return undefined;
  return semantics.sort(row);
};

const compare = (a: string | number | undefined, b: string | number | undefined): number => {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
};

const snapshotFeed = (
  result: AsyncResult.AsyncResult<TakeoffSnapshot | null, Error>,
  options: (snapshot: TakeoffSnapshot) => Feed["options"],
  needs: string,
): Feed => {
  if (AsyncResult.isInitial(result))
    return { options: null, state: "loading", lane: "read", stale: false, seam: { needs } };
  if (AsyncResult.isFailure(result))
    return {
      options: null,
      state: "error",
      lane: "read",
      stale: false,
      note: String(Cause.squash(result.cause)),
      seam: { needs },
    };
  return {
    options: result.value ? options(result.value) : null,
    state: "ready",
    lane: "read",
    stale: result.waiting,
    seam: { needs },
  };
};

export function createTakeoffStore(deps: {
  host: TakeoffHost;
  sessions: SessionSource;
  search: SearchPort;
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  slice?: Atom.Atom<AsyncResult.AsyncResult<Slice<TakeoffsRouteDocument>, Error>>;
  writer?: {
    apply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
    command?(name: string, input?: unknown): Promise<RouteStateWriteResult>;
  };
}) {
  const core = createRouteStoreCore("takeoffs", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.runtime;
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  // FOOTGUN: reads and core invalidation must share Atom.runtime's Reactivity memo map.
  Reflect.set(runtime.layer, "keepAlive", false);
  const takeoffsSlice = core.owned(
    "slice/takeoffs",
    deps.slice ?? docAtom(takeoffsRouteState, deps.scope),
  );
  const takeoffsWriter = deps.writer ?? docWriter(takeoffsRouteState, deps.scope);
  const searchAtom = Atom.make<TakeoffSearch>(EMPTY_TAKEOFF_SEARCH).pipe(owned("search"));
  const targetAtom = Atom.make((get) => {
    const result = get(takeoffsSlice);
    return AsyncResult.isSuccess(result) ? (result.value.doc?.binding.target ?? "") : "";
  }).pipe(owned("binding/target"));
  const sourceAtom = Atom.make((get) => get(searchAtom).source).pipe(
    owned("search/source"),
  );
  const viewsAtom = Atom.make((get) => get(searchAtom).views).pipe(owned("search/views"));
  const zonesAtom = Atom.make((get) => get(searchAtom).zones).pipe(owned("search/zones"));
  const dirAtom = Atom.make((get) => get(searchAtom).dir).pipe(owned("search/dir"));
  const r10PathAtom = Atom.make((get) => get(searchAtom).r10).pipe(owned("search/r10"));
  const stageAtom = Atom.make((get) => get(searchAtom).stage).pipe(owned("search/stage"));
  const recentDirsAtom = Atom.make<readonly string[]>([]).pipe(Atom.autoDispose);
  const currentHoverAtom = Atom.make("").pipe(owned("page/hover"));
  const busyAtom = core.busy;
  const failureAtom = core.failure;
  const receiptAtom = core.receipt;
  const zoneKeyAtom = Atom.make<AtlasPageState["zoneKey"]>(null).pipe(
    owned("page/atlas/zone-key"),
  );
  const stageFilterAtom = Atom.make<AtlasPageState["stageFilter"]>(null).pipe(
    owned("page/atlas/stage-filter"),
  );
  const levelAtom = Atom.make("").pipe(owned("page/atlas/level"));
  const fieldsModeAtom = Atom.make<AtlasPageState["fieldsMode"]>("columns").pipe(
    owned("page/atlas/fields-mode"),
  );
  const planOpenAtom = Atom.make(true).pipe(owned("page/atlas/plan-open"));
  const statsOpenAtom = Atom.make(false).pipe(owned("page/atlas/stats-open"));
  const targetingOpenAtom = Atom.make<string | null>(null).pipe(
    owned("page/targeting/open"),
  );
  const targetingLevelAtom = Atom.make<string | null>(null).pipe(
    owned("page/targeting/level"),
  );
  const targetingQueryAtom = Atom.make("").pipe(owned("page/targeting/query"));
  const cursorAtom = Atom.make<AtlasPageState["cursor"]>(null).pipe(
    owned("page/atlas/cursor"),
  );
  const atlasPageAtom = Atom.make(
    (get): AtlasPageState => ({
      stageFilter: get(stageFilterAtom),
      level: get(levelAtom),
      zoneKey: get(zoneKeyAtom),
      cursor: get(cursorAtom),
      fieldsMode: get(fieldsModeAtom),
      planOpen: get(planOpenAtom),
      statsOpen: get(statsOpenAtom),
    }),
  ).pipe(owned("page/atlas"));
  const atlasTableStateAtom = Atom.make<MasterTableState>({
    filters: {},
    sorts: [],
    query: "",
  }).pipe(owned("page/atlas-table"));
  const replaysAtom = Atom.make<Readonly<Record<string, string>>>({}).pipe(
    Atom.autoDispose,
  );
  const panelAtom = Atom.make<"adopt" | "sync" | null>(null).pipe(owned("page/panel"));
  const adoptPatchesAtom = Atom.make<Readonly<Record<string, Partial<AdoptDraft>>>>({}).pipe(
    Atom.autoDispose,
  );
  const decisionsAtom = Atom.make<Readonly<Record<string, "accept" | "dismiss">>>({}).pipe(
    owned("page/decisions"),
  );
  const stagedEditsAtom = Atom.make((get): Readonly<Record<string, StagedRoomEdit>> => {
    const result = get(takeoffsSlice);
    if (!AsyncResult.isSuccess(result) || !result.value.doc) return {};
    return Object.fromEntries(
      result.value.doc.staged.map(({ roomId, ...edit }) => [roomId, { roomId, ...edit }]),
    );
  }).pipe(Atom.autoDispose);
  const hoveredAtom = Atom.family((_id: string) =>
    Atom.make(false).pipe(Atom.autoDispose),
  );
  const boundAtom = Atom.family((_id: string) =>
    Atom.make(false).pipe(Atom.autoDispose),
  );
  const decidedAtom = Atom.family((id: string) =>
    Atom.make((get) =>
      Object.fromEntries(
        Object.entries(get(decisionsAtom))
          .filter(([key]) => key.startsWith(`${id}::`))
          .map(([key, verdict]) => [key.slice(id.length + 2), verdict]),
      ),
    ).pipe(Atom.autoDispose),
  );
  const stagedAtom = Atom.family((id: string) =>
    Atom.make((get) => get(stagedEditsAtom)[id] ?? null).pipe(Atom.autoDispose),
  );

  const sessionsSource = runtime
    .atom(() => hostRead(["sessions"], () => deps.sessions.list()))
    .pipe(Atom.autoDispose);
  const sessionsResult = runtimeFactory
    .withReactivity(["sessions"])(sessionsSource)
    .pipe(Atom.autoDispose);
  const activeDocumentSource = runtime
    .atom((get) => {
      const target = get(targetAtom);
      return Effect.gen(function* () {
        const read = yield* get.result(sessionsResult, { suspendOnWaiting: true });
        const resolution = resolveTarget(read.value, target);
        if (resolution.kind !== "resolved") return unbound<ActiveDocument | null>(null, [target]);
        const document = yield* hostRead([resolution.session.sessionId], () =>
          deps.sessions.activeDocument(resolution.session),
        );
        return document;
      });
    })
    .pipe(Atom.autoDispose);
  const activeDocumentResult = runtimeFactory
    .withReactivity(["active-document"])(activeDocumentSource)
    .pipe(Atom.autoDispose);
  const recentDocumentsSource = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const target = get(targetAtom);
        const read = yield* get.result(sessionsResult, { suspendOnWaiting: true });
        const resolution = resolveTarget(read.value, target);
        if (resolution.kind !== "resolved" || !deps.host.listRecentDocuments)
          return unbound<readonly RecentDocument[]>([], [target]);
        const session = read.value.find(
          (candidate) => candidate.sessionId === resolution.session.sessionId,
        )!;
        return yield* hostRead(
          [session.sessionId, session.year ?? "all"],
          () => deps.host.listRecentDocuments!(session.year),
        );
      }),
    )
    .pipe(Atom.autoDispose);
  const recentDocumentsResult = runtimeFactory
    .withReactivity(["recent-documents"])(
      Atom.swr(recentDocumentsSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const snapshotProducerSource = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        if (!document.value) return unbound<TakeoffSnapshot | null>(null, document.basis);
        return yield* hostRead([document.value.session.sessionId, document.value.title], () =>
          deps.host.readSnapshot(document.value!.session, document.value!, async (snapshot) => {
            const result = await takeoffsWriter.apply([{ path: ["snapshot"], value: snapshot }]);
            if (!result.ok) throw Error(result.error ?? "snapshot write failed");
          }),
        );
      }),
    )
    .pipe(Atom.autoDispose);
  const snapshotProducerResult = runtimeFactory
    .withReactivity(["snapshot"])(
      Atom.swr(snapshotProducerSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const snapshotResult = Atom.make((get) => {
    const slice = get(takeoffsSlice);
    if (AsyncResult.isSuccess(slice)) {
      if (!slice.value.hydrated) return AsyncResult.initial();
      if (slice.value.error) return AsyncResult.fail(Error(slice.value.error));
      if (slice.value.doc?.snapshot) {
        const producer = get(snapshotProducerResult);
        return AsyncResult.success(slice.value.doc.snapshot, {
          waiting: AsyncResult.isSuccess(producer) && producer.waiting,
        });
      }
    }
    const producer = get(snapshotProducerResult);
    return AsyncResult.isSuccess(producer)
      ? AsyncResult.map(slice, (value) => value.doc?.snapshot ?? null)
      : AsyncResult.map(producer, () => null);
  }).pipe(Atom.autoDispose);
  const candidatesSource = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        const views = get(viewsAtom);
        if (!document.value || views.length === 0)
          return unbound<CandidateRegion[]>([], document.basis);
        return yield* hostRead([document.value.session.sessionId, ...views], async () => {
          const candidates: CandidateRegion[] = [];
          for (const view of views)
            candidates.push(
              ...(await deps.host.readCandidates(document.value!.session, view)).map(
                (candidate) => ({ ...candidate, view }),
              ),
            );
          return candidates;
        });
      }),
    )
    .pipe(Atom.autoDispose);
  const candidatesResult = runtimeFactory
    .withReactivity(["candidates"])(
      Atom.swr(candidatesSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const adoptRowsAtom = Atom.make((get): readonly AdoptDraft[] | null => {
    const result = get(candidatesResult);
    if (!AsyncResult.isSuccess(result) || !result.value.bound) return null;
    const patches = get(adoptPatchesAtom);
    return result.value.value.map((region) => {
      // an unstamped designer region carries no provenance blob; only a stamped one parses
      const meta = region.role === "zoning-region" ? readZoneMeta(region.blob) : null;
      return {
        region,
        view: region.view,
        checked: region.role === "zoning-region",
        name: meta?.name || region.typeName,
        systemTag: meta?.systemTag ?? "",
        ...patches[`${region.view}:${region.elementId}`],
      };
    });
  }).pipe(owned("page/adopt-rows"));
  const foldersSource = runtime
    .atom((get) =>
      Effect.succeed({
        value: get(recentDirsAtom),
        at: Date.now(),
        basis: ["browser"],
        bound: true,
      } satisfies TimedRead<readonly string[]>),
    )
    .pipe(Atom.autoDispose);
  const foldersResult = runtimeFactory
    .withReactivity(["folders"])(foldersSource)
    .pipe(Atom.autoDispose);
  const listingSource = runtime
    .atom((get) => {
      const dir = get(dirAtom);
      return dir
        ? hostRead([dir], () => deps.host.listRhvac(dir))
        : Effect.succeed(unbound<RhvacFile[]>([], []));
    })
    .pipe(Atom.autoDispose);
  const listingResult = runtimeFactory
    .withReactivity(["rhvac-list"])(
      Atom.swr(listingSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const r10Source = runtime
    .atom((get) => {
      const path = get(r10PathAtom);
      return Effect.gen(function* () {
        const files = yield* get.result(listingResult, { suspendOnWaiting: true });
        if (!path) return unbound<unknown>(null, files.basis);
        if (!files.value.some((file) => file.path === path))
          return yield* Effect.fail(Error(`unknown .r10 ${path}`));
        return yield* hostRead([path], () => deps.host.openRhvac(path));
      });
    })
    .pipe(Atom.autoDispose);
  const r10Result = runtimeFactory
    .withReactivity(["rhvac-open"])(
      Atom.swr(r10Source, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);

  const sessionsFeed = Atom.make((get) =>
    feed(
      get(sessionsResult),
      (items) =>
        items.map((session) => ({
          id: mintSelector(session, items),
          label: session.activeDocumentTitle ?? `Revit ${session.processId}`,
        })),
      deps.host.fixture ? "fixture" : "live",
      { needs: TAKEOFF_LINKS[0]!.needs },
    ),
  ).pipe(owned("feed/world"));
  const documentFeed = Atom.make((get) => {
    const document = get(activeDocumentResult);
    if (deps.host.fixture || !deps.host.listRecentDocuments)
      return feed(
        document,
        (active) => (active ? [{ id: active.title, label: active.title }] : []),
        deps.host.fixture ? "fixture" : "live",
        { needs: TAKEOFF_LINKS[1]!.needs },
      );
    return feed(
      get(recentDocumentsResult),
      (recents) => {
        const active = AsyncResult.isSuccess(document) ? document.value.value : null;
        return [
          ...(active ? [{ id: active.title, label: active.title }] : []),
          ...recents
            .filter((recent) => recent.title !== active?.title)
            .map((recent) => ({
              id: recent.title,
              label: recent.title,
              sub: recent.isCloud ? "cloud" : recent.path,
            })),
        ];
      },
      "live",
      { needs: TAKEOFF_LINKS[1]!.needs },
    );
  }).pipe(owned("feed/rvt"));
  const viewsFeed = Atom.make((get) =>
    snapshotFeed(
      get(snapshotResult),
      (snapshot) =>
        snapshot.views.map((view) => ({ id: view.name, label: view.name, sub: view.level })),
      TAKEOFF_LINKS[2]!.needs,
    ),
  ).pipe(owned("feed/views"));
  const zonesFeed = Atom.make((get) =>
    snapshotFeed(
      get(snapshotResult),
      (snapshot) =>
        snapshot.world.zones.map((zone) => ({ id: zone.zone.guid, label: zone.name })),
      TAKEOFF_LINKS[3]!.needs,
    ),
  ).pipe(owned("feed/zones"));
  const folderFeed = Atom.make((get) =>
    feed(
      get(foldersResult),
      (dirs) => dirs.map((dir) => ({ id: dir, label: dir })),
      "read",
      { needs: TAKEOFF_LINKS[4]!.needs },
    ),
  ).pipe(owned("feed/folder"));
  const r10Feed = Atom.make((get) =>
    feed(
      get(listingResult),
      (files) => files.map((file) => ({ id: file.path, label: file.name })),
      "read",
      { needs: TAKEOFF_LINKS[5]!.needs },
    ),
  ).pipe(owned("feed/r10"));
  const authorityWorldAtom = Atom.make((get): World => {
    const result = get(snapshotResult);
    return AsyncResult.isSuccess(result) && result.value ? result.value.world : EMPTY_WORLD;
  }).pipe(Atom.autoDispose);
  const worldAtom = Atom.make((get): World => {
    const authority = get(authorityWorldAtom);
    const staged = get(stagedEditsAtom);
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
        rooms: zone.rooms.map((room) => applyEdit(room, staged[room.guid]?.next)),
      })),
    };
  }).pipe(owned("world"));
  const roomsByIdAtom = Atom.make(
    (get) =>
      new Map(
        get(authorityWorldAtom)
          .zones.flatMap((zone) => zone.rooms)
          .map((room) => [room.guid, room] as const),
      ),
  ).pipe(Atom.autoDispose);
  const selectedAtom = Atom.family((id: string) =>
    Atom.make((get) => {
      if (get(cursorAtom) === id) return true;
      const zoneKey = get(zoneKeyAtom);
      return (
        zoneKey !== null &&
        get(worldAtom).zones.some((zone) => zone.zone.key === zoneKey && zone.zone.guid === id)
      );
    }).pipe(Atom.autoDispose),
  );
  const atlasRowsAtom = Atom.make((get): readonly AtlasRow[] => {
    const zoneKey = get(zoneKeyAtom);
    const stageFilter = get(stageFilterAtom);
    const decisions = get(decisionsAtom);
    const world = get(worldAtom);
    const selected = zoneKey ? world.zones.find((zone) => zone.zone.key === zoneKey) : undefined;
    const zones = selected
      ? [selected]
      : world.zones.filter((zone) => stageFilter === null || zone.stage === stageFilter);
    return zones.flatMap((zone) =>
      zone.rooms.map((room) => {
        const open = room.flags.filter((flag) => decisions[`${room.guid}::${flag}`] === undefined);
        return { zone, room, open, state: atlasRoomState(room, open.length) };
      }),
    );
  }).pipe(owned("page/atlas-rows"));
  const visibleRowsAtom = Atom.make((get): readonly string[] => {
    const fieldsMode = get(fieldsModeAtom);
    const state = get(atlasTableStateAtom);
    const query = state.query.trim().toLowerCase();
    return get(atlasRowsAtom)
      .filter(
        (row) =>
          (!query ||
            [row.zone.zone.key, row.room.name, row.room.type].some((value) =>
              value.toLowerCase().includes(query),
            )) &&
          Object.entries(state.filters).every(
            ([key, value]) =>
              atlasColumnSemantics(key)?.match?.(row, value) ?? atlasFacet(row, key) === value,
          ),
      )
      .sort((left, right) => {
        for (const sort of state.sorts) {
          const order = compare(
            atlasSortValue(left, sort.key, fieldsMode),
            atlasSortValue(right, sort.key, fieldsMode),
          );
          if (order !== 0) return sort.dir === "desc" ? -order : order;
        }
        return 0;
      })
      .map((row) => row.room.guid);
  }).pipe(owned("page/atlas-visible-rows"));
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
  }).pipe(owned("page/sync-plan"));
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
    }).pipe(owned(`entity/${id}`)),
  );

  const invalidateAtom = runtime
    .fn((keys: readonly string[]) => Reactivity.invalidate(keys))
    .pipe(Atom.autoDispose);
  const settle = <A>(atom: Atom.Atom<AsyncResult.AsyncResult<A, Error>>) => {
    registry.get(atom);
    return Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }));
  };
  const replaceStaging = (
    verb: string,
    update: (
      edits: Readonly<Record<string, StagedRoomEdit>>,
    ) => Readonly<Record<string, StagedRoomEdit>>,
  ) => {
    const next = update(registry.get(stagedEditsAtom));
    return write(verb, "slice/takeoffs/staged", () =>
      takeoffsWriter.apply([
        {
          path: ["staged"],
          value: Object.entries(next).map(([roomId, edit]) => ({ ...edit, roomId })),
        },
      ]),
    );
  };
  const clearStaging = () => {
    return replaceStaging("clear-staging", () => ({}));
  };
  const stageRoom = (id: string, patch: RoomEdit) => {
    const authority = registry.get(roomsByIdAtom).get(id);
    if (!authority) throw Error(`unknown room ${id}`);
    const staged = registry.get(stagedAtom(id));
    const base = staged?.base ?? roomEdit(authority);
    const next = { ...(staged?.next ?? base), ...patch };
    void replaceStaging("stage-room", (edits) => ({
      ...edits,
      [id]: { roomId: id, base, next },
    }));
    return authority;
  };
  const commitRoomField = (id: string, patch: RoomEdit) => {
    const staged = registry.get(stagedAtom(id));
    if (!staged) return;
    const base = { ...staged.base, ...patch };
    const next = { ...staged.next, ...patch };
    if (JSON.stringify(base) === JSON.stringify(next)) {
      void replaceStaging("commit-room", (edits) => {
        const { [id]: _, ...rest } = edits;
        return rest;
      });
    } else
      void replaceStaging("commit-room", (edits) => ({
        ...edits,
        [id]: { roomId: id, base, next },
      }));
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
  };
  const openSelectedDocument = (title: string) =>
    runVerb(
      "open-document",
      async () => {
        const sessions = await settle(sessionsResult);
        const resolution = resolveTarget(sessions.value, registry.get(targetAtom));
        if (resolution.kind !== "resolved") throw Error("no world bound");
        const { session } = resolution;
        if (!session.sdkSessionId)
          throw Error("open the document in Revit; this session is observed");
        const recents = await settle(recentDocumentsResult);
        const recent = recents.value.find((candidate) => candidate.title === title);
        if (!recent) throw Error(`unknown recent document ${title}`);
        if (!deps.host.openDocument) throw Error("document opening is unavailable");
        // SHIM: the CLI resolves cloud models only through `recent:<title>`; a literal `cld://`
        // path is read as a local file (Pe.Revit.Sdk NEXT.md gap). Dies when `doc open <cld://…>` resolves.
        await deps.host.openDocument({
          path: recent.isCloud ? `recent:${recent.title}` : recent.path,
          id: session.sdkSessionId,
          ...(recent.isCloud ? { conflictPolicy: "keep" as const } : {}),
        });
        return { text: `opened ${recent.title}` };
      },
      ["snapshot", "candidates"],
    ).catch(() => undefined);
  const unsubscribe = deps.sessions.subscribe((event) => {
    if (event.kind === "sessionsChanged") {
      write("host-event", "invalidate/sessions", () => registry.set(invalidateAtom, ["sessions"]));
      return;
    }
    const document = registry.get(activeDocumentResult);
    const current = AsyncResult.isSuccess(document)
      ? document.value.value?.session.sessionId
      : null;
    if (current !== event.sessionId) return;
    write("host-event", "invalidate/sessions,active-document", () =>
      registry.set(invalidateAtom, ["sessions", "active-document"]),
    );
  });

  const feeds = {
    world: sessionsFeed,
    rvt: documentFeed,
    views: viewsFeed,
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
      const nextTarget = patch.bound?.world ?? "";
      if (current.source === "live" && patch.bound && nextTarget !== registry.get(targetAtom))
        void takeoffsWriter.command?.("bind", { target: nextTarget || null });
      deps.search.patch({
        ...(patch.stage ? { stage: patch.stage as TakeoffStage } : {}),
        ...(patch.bound
          ? {
              dir: patch.bound.folder ?? "",
              r10: patch.bound.r10 ?? "",
            }
          : {}),
        ...(patch.multi
          ? {
              views: [...(patch.multi.views ?? [])],
              zones: [...(patch.multi.zones ?? [])],
            }
          : {}),
      });
      const nextDocument = patch.bound?.rvt;
      const sessions = registry.get(sessionsResult);
      const resolution = AsyncResult.isSuccess(sessions)
        ? resolveTarget(sessions.value.value, registry.get(targetAtom))
        : null;
      const activeTitle =
        resolution?.kind === "resolved" ? resolution.session.activeDocumentTitle : undefined;
      if (current.source === "live" && nextDocument && nextDocument !== activeTitle)
        return openSelectedDocument(nextDocument);
    },
    settle,
    invalidate: (keys: readonly string[]) =>
      write("invalidate", keys.join(","), () => registry.set(invalidateAtom, keys)),
    retryRhvac() {
      return runVerb(
        "retry-r10",
        async () => "retrying .r10",
        ["rhvac-open", "rhvac-list"],
      );
    },
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
      const currentHover = registry.get(currentHoverAtom);
      if (id === currentHover) return;
      Atom.batch(() => {
        if (currentHover)
          write("hover", `entity/${currentHover}/hovered`, () =>
            registry.set(hoveredAtom(currentHover), false),
          );
        write("hover", "page/hover", () => registry.set(currentHoverAtom, id));
        if (id) write("hover", `entity/${id}/hovered`, () => registry.set(hoveredAtom(id), true));
      });
    },
    setAtlasPage(patch: Partial<AtlasPageState>) {
      write("set-atlas-page", "page/atlas", () =>
        Atom.batch(() => {
          if (patch.stageFilter !== undefined) registry.set(stageFilterAtom, patch.stageFilter);
          if (patch.level !== undefined) registry.set(levelAtom, patch.level);
          if (patch.zoneKey !== undefined) registry.set(zoneKeyAtom, patch.zoneKey);
          if (patch.cursor !== undefined) registry.set(cursorAtom, patch.cursor);
          if (patch.fieldsMode !== undefined) registry.set(fieldsModeAtom, patch.fieldsMode);
          if (patch.planOpen !== undefined) registry.set(planOpenAtom, patch.planOpen);
          if (patch.statsOpen !== undefined) registry.set(statsOpenAtom, patch.statsOpen);
        }),
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
    setTargetingOpen(key: string | null) {
      write("set-targeting-open", "page/targeting/open", () =>
        registry.set(targetingOpenAtom, key),
      );
    },
    setTargetingLevel(key: string) {
      write("set-targeting-level", "page/targeting/level", () =>
        registry.set(targetingLevelAtom, key),
      );
    },
    setTargetingQuery(query: string) {
      write("set-targeting-query", "page/targeting/query", () =>
        registry.set(targetingQueryAtom, query),
      );
    },
    openPanel(panel: "adopt" | "sync" | null) {
      write("open-panel", "page/panel", () => registry.set(panelAtom, panel));
    },
    openAdopt() {
      return runVerb("adopt", async () => {
        write("adopt", "page/panel", () => registry.set(panelAtom, "adopt"));
        return "opened adopt";
      });
    },
    openSync() {
      return runVerb("sync", async () => {
        write("sync", "page/panel", () => registry.set(panelAtom, "sync"));
        return "opened sync";
      });
    },
    clearFailure() {
      write("clear-failure", "failure", () => registry.set(failureAtom, null));
    },
    patchAdopt(view: string, elementId: number, patch: Partial<AdoptDraft>) {
      const key = `${view}:${elementId}`;
      write("patch-adopt", "page/adopt-patches", () =>
        registry.update(adoptPatchesAtom, (patches) => ({
          ...patches,
          [key]: { ...patches[key], ...patch },
        })),
      );
    },
    decide(id: string, flag: string, verdict: "accept" | "dismiss") {
      write("decide", `entity/${id}/decided`, () =>
        registry.update(decisionsAtom, (decisions) => ({
          ...decisions,
          [`${id}::${flag}`]: verdict,
        })),
      );
    },
    stage(id: string, base: RoomEdit, next: RoomEdit) {
      const staged = JSON.stringify(base) === JSON.stringify(next) ? null : { base, next };
      return replaceStaging("stage", (edits) => {
        if (staged) return { ...edits, [id]: { roomId: id, ...staged } };
        const { [id]: _, ...rest } = edits;
        return rest;
      });
    },
    patchRoom(id: string, patch: RoomEdit) {
      const room = stageRoom(id, patch);
      if (deps.host.fixture || patch.type === undefined || room.elementId === null) return;
      void runVerb(
        "room-type",
        async () => {
          const session = await activeSession();
          await deps.host.writeRoomType(session, room.elementId!, patch.type!);
          commitRoomField(id, { type: patch.type });
        },
        ["snapshot"],
      ).catch(() => undefined);
    },
    decideRoom(room: WorldRoom, flag: string, verdict: "accept" | "dismiss") {
      write("decision", `entity/${room.guid}/decided`, () =>
        registry.update(decisionsAtom, (decisions) => ({
          ...decisions,
          [`${room.guid}::${flag}`]: verdict,
        })),
      );
      if (deps.host.fixture) return;
      void runVerb(
        "decision",
        async () => {
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
        },
        ["snapshot"],
      ).catch(() => undefined);
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
      return runVerb(
        "partition",
        async () => {
          const replayPath = registry.get(replaysAtom)[zone.zone.lane.label];
          if (!replayPath) throw Error(`capture ${zone.zone.lane.label} first`);
          const session = await activeSession();
          const result = await deps.host.partition(session, partitionInput(zone, replayPath));
          return { ...result, text: `partitioned ${zone.zone.key}` };
        },
        ["snapshot"],
      );
    },
    refresh() {
      return runVerb("refresh", async () => "refreshing", ["snapshot"]);
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
      return runVerb(
        "sync",
        async () => {
          const path = registry.get(r10PathAtom);
          if (!path) throw Error("no .r10 bound");
          const plan = registry.get(syncPlanAtom);
          if (plan.inserts.length === 0) throw Error("no rooms are eligible to sync");
          if (plan.untagged > 0) throw Error(`${plan.untagged} eligible rooms have no system tag`);
          const session = await activeSession();
          const result = await deps.host.syncRhvac(session, path, plan.inserts);
          clearStaging();
          write("sync", "page/panel", () => registry.set(panelAtom, null));
          return result;
        },
        ["snapshot", "rhvac-open"],
      );
    },
    adopt(inputs: readonly { readonly view: string; readonly items: readonly AdoptItem[] }[]) {
      return runVerb(
        "adopt",
        async () => {
          const session = await activeSession();
          const landed: string[] = [];
          for (const input of inputs) {
            try {
              await deps.host.adopt(session, input);
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : String(cause);
              throw Error(
                `${input.view} failed after ${landed.length ? `${landed.join(", ")} landed` : "no views landed"}: ${message}`,
              );
            }
            landed.push(input.view);
          }
          return {
            text: `${inputs.reduce((total, input) => total + input.items.length, 0)} regions across ${landed.length} views`,
          };
        },
        ["snapshot", "candidates"],
      );
    },
    adoptSelected() {
      const views = registry.get(viewsAtom);
      const rows = registry.get(adoptRowsAtom)?.filter((row) => row.checked) ?? [];
      return actions
        .adopt(
          views.map((view) => ({
            view,
            items: rows
              .filter((row) => row.view === view)
              .map((row) => ({
                elementId: row.region.elementId,
                name: row.name,
                systemTag: row.systemTag,
              })),
          })),
        )
        .then((result) => {
          write("adopt", "page/adopt-patches", () => registry.set(adoptPatchesAtom, {}));
          write("adopt", "page/panel", () => registry.set(panelAtom, null));
          return result;
        });
    },
  };

  const store = {
    registry,
    slices: { takeoffs: takeoffsSlice },
    atoms: {
      registry,
      search: searchAtom,
      target: targetAtom,
      source: sourceAtom,
      views: viewsAtom,
      zones: zonesAtom,
      dir: dirAtom,
      r10Path: r10PathAtom,
      stage: stageAtom,
      world: worldAtom,
      atlasPage: atlasPageAtom,
      zoneKey: zoneKeyAtom,
      stageFilter: stageFilterAtom,
      level: levelAtom,
      fieldsMode: fieldsModeAtom,
      planOpen: planOpenAtom,
      statsOpen: statsOpenAtom,
      targetingOpen: targetingOpenAtom,
      targetingLevel: targetingLevelAtom,
      targetingQuery: targetingQueryAtom,
      cursor: cursorAtom,
      hover: currentHoverAtom,
      atlasTableState: atlasTableStateAtom,
      atlasRows: atlasRowsAtom,
      visibleRows: visibleRowsAtom,
      decisions: decisionsAtom,
      panel: panelAtom,
      syncPlan: syncPlanAtom,
      sessions: sessionsResult,
      activeDocument: activeDocumentResult,
      recentDocuments: recentDocumentsResult,
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
    dispose() {
      unsubscribe();
      core.dispose();
    },
  };
  return store;
}

export type TakeoffStore = ReturnType<typeof createTakeoffStore>;
