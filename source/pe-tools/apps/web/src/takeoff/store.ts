/**
 * Takeoffs — the route's projections and its page memory, and nothing else.
 *
 * The owner, the registry, the conflict banner, refusal plumbing, the Target resolution and the
 * host caller all live in `useRoute` now; the Work doc type, the Readings and the actions live in
 * `takeoff/manifest.ts`. What is left here is what only Takeoffs knows: how a `TakeoffModel`
 * becomes atlas rows, what a sync plan is, and which page selections the view holds while it is
 * open. Everything is a plain value — no atoms, no `AsyncResult`, no `Scope`.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  ActionStatus,
  CandidateRegion,
  Reading,
  StagedRoomEdit,
  TakeoffCapture,
  TakeoffSnapshot,
  TakeoffObservation,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import { previousOf } from "#/readings";
import { useRoute } from "#/route";
import {
  manifest,
  snapshotOfObservation,
  syncPlan,
  type TakeoffReadingKey,
} from "#/takeoff/manifest";
import {
  readZoneMeta,
  STAGE_ORDER,
  applyEdit,
  type RoomEdit,
  type TakeoffModel,
  type ModelRoom,
  type ModelZone,
} from "#/takeoff/world";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export interface TakeoffSelection {
  readonly views: readonly string[];
  readonly zones: readonly string[];
  readonly dir: string;
  readonly r10: string;
  readonly stage: "adopt" | "audit" | "sync";
}

export const EMPTY_TAKEOFF_SELECTION: TakeoffSelection = {
  views: [],
  zones: [],
  dir: "",
  r10: "",
  stage: "adopt",
};

interface AtlasPageState {
  readonly stageFilter: TakeoffModel["zones"][number]["stage"] | null;
  readonly level: string;
  readonly zoneKey: string | null;
  readonly cursor: string | null;
  readonly fieldsMode: "columns" | "panel";
  readonly planOpen: boolean;
  readonly statsOpen: boolean;
}

const EMPTY_ATLAS: AtlasPageState = {
  stageFilter: null,
  level: "",
  zoneKey: null,
  cursor: null,
  fieldsMode: "columns",
  planOpen: true,
  statsOpen: false,
};

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
  readonly zone: ModelZone;
  readonly room: ModelRoom;
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

/** Caller-held plain page memory; authored room proposals stay in Work. */
export interface TakeoffPageSeed extends TakeoffSelection {
  readonly atlas?: Partial<AtlasPageState>;
  readonly table?: MasterTableState;
  readonly hover?: string;
  readonly recentDirs?: readonly string[];
  readonly targeting?: { open: string | null; level: string | null; query: string };
  readonly panel?: "sync" | null;
}

/* ── Pure projections ──────────────────────────────────────────────────────── */

const EMPTY_WORLD: TakeoffModel = { docName: "", r10Path: null, lanes: [], zones: [], systems: [] };

export const roomEdit = (room: ModelRoom): RoomEdit => ({
  name: room.name,
  type: room.type,
  ceilingFt: room.ceilingFt,
  people: room.data?.people,
  lightingW: room.data?.lightingW,
  equipSensible: room.data?.equipSensible,
  equipLatent: room.data?.equipLatent,
  ventilationCfm: room.data?.ventilationCfm,
});

export function atlasRoomState(room: ModelRoom, open: number): AtlasRoomState {
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

/** Authority geometry plus the staged room edits the Work doc carries. */
export function stagedModel(
  authority: TakeoffModel,
  staged: Readonly<Record<string, StagedRoomEdit>>,
): TakeoffModel {
  return {
    ...authority,
    zones: authority.zones.map((zone) => ({
      ...zone,
      rooms: zone.rooms.map((room) => applyEdit(room, staged[room.guid]?.next)),
    })),
  };
}

export function atlasRows(
  world: TakeoffModel,
  page: { zoneKey: string | null; stageFilter: AtlasPageState["stageFilter"] },
  decisions: Readonly<Record<string, "accept" | "dismiss">>,
): readonly AtlasRow[] {
  const selected = page.zoneKey
    ? world.zones.find((zone) => zone.zone.guid === page.zoneKey)
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
}

export function visibleRowKeys(
  rows: readonly AtlasRow[],
  state: MasterTableState,
  fieldsMode: AtlasPageState["fieldsMode"],
): readonly string[] {
  const query = state.query.trim().toLowerCase();
  return rows
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
}

/** A stamped designer region carries provenance; an unstamped one is named from the view. */
export function adoptDrafts(
  candidates: readonly CandidateRegion[],
  patches: Readonly<Record<string, Partial<AdoptDraft>>>,
): readonly AdoptDraft[] {
  return candidates.map((region) => {
    const meta = region.role === "zoning-region" ? readZoneMeta(region.blob) : null;
    return {
      region,
      view: region.view,
      checked: region.role === "zoning-region",
      name: meta?.name || region.typeName || `${region.view} · ${region.elementId}`,
      systemTag: meta?.systemTag ?? "",
      ...patches[`${region.view}:${region.elementId}`],
    };
  });
}

/* ── The store: one `useRoute` handle plus this route's page memory ────────── */

const observed = <T>(reading: Reading<unknown> | undefined): T | undefined =>
  reading === undefined
    ? undefined
    : reading.state === "ready"
      ? (reading.observation as T)
      : (previousOf(reading) as T | undefined);

interface TakeoffPageMemory {
  readonly atlas: AtlasPageState;
  readonly table: MasterTableState;
  readonly hover: string;
  readonly recentDirs: readonly string[];
  readonly targeting: { open: string | null; level: string | null; query: string };
}

const initialMemory = (seed?: TakeoffPageSeed): TakeoffPageMemory => ({
  atlas: { ...EMPTY_ATLAS, ...seed?.atlas },
  table: seed?.table ?? { filters: {}, sorts: [], query: "" },
  hover: seed?.hover ?? "",
  recentDirs: seed?.recentDirs ?? [],
  targeting: seed?.targeting ?? { open: null, level: null, query: "" },
});

export function useTakeoffStore(options: {
  target?: string;
  work?: string;
  savedCapture?: TakeoffCapture;
  pageSeed?: TakeoffPageSeed;
}) {
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
    ...(options.work !== undefined ? { work: options.work } : {}),
    page: options.pageSeed
      ? {
          views: options.pageSeed.views,
          zones: options.pageSeed.zones,
          dir: options.pageSeed.dir,
          r10: options.pageSeed.r10,
          stage: options.pageSeed.stage,
          panel: options.pageSeed.panel ?? null,
          syncReview: null,
        }
      : undefined,
  });
  const [page, setPage] = handle.page;
  const [memory, setMemory] = useState<TakeoffPageMemory>(() => initialMemory(options.pageSeed));
  const patch = useCallback(
    (next: Partial<TakeoffPageMemory>) => setMemory((current) => ({ ...current, ...next })),
    [],
  );

  const observation = handle.readings.snapshot as Reading<TakeoffObservation> | undefined;
  const projectSnapshot = (): Reading<TakeoffSnapshot> => {
    if (!observation || observation.state === "absent") return { state: "absent" };
    const value = observed<TakeoffObservation>(observation);
    const previous = snapshotOfObservation(value);
    if (observation.state !== "ready") {
      if (observation.state === "stale")
        return previous ? { ...observation, previous } : { state: "absent" };
      return { ...observation, previous };
    }
    if (value?.kind === "failed") return { state: "failed", message: value.error, previous };
    if (value?.kind === "reading")
      return previous ? { state: "stale", previous, reason: "dirtied" } : { state: "absent" };
    return previous ? { state: "ready", observation: previous } : { state: "absent" };
  };
  const snapshot = projectSnapshot();
  const capture = options.savedCapture;
  const authority =
    capture?.snapshot?.world ?? observed<TakeoffSnapshot>(snapshot)?.world ?? EMPTY_WORLD;
  const staged = useMemo(
    () =>
      Object.fromEntries(
        (handle.work.doc?.staged ?? []).map((edit) => [edit.roomId, edit]),
      ) as Record<string, StagedRoomEdit>,
    [handle.work.doc],
  );
  const world = useMemo(() => stagedModel(authority, staged), [authority, staged]);
  const candidates = observed<TakeoffSnapshot>(snapshot)?.zoneFrs;
  const adoptPatches = handle.work.doc?.adoptPatches ?? {};
  const decisions = handle.work.doc?.decisions ?? {};
  const adoptRows = useMemo(
    () => (candidates ? adoptDrafts(candidates, adoptPatches) : null),
    [candidates, adoptPatches],
  );
  const rows = useMemo(
    () =>
      atlasRows(
        world,
        { zoneKey: memory.atlas.zoneKey, stageFilter: memory.atlas.stageFilter },
        decisions,
      ),
    [world, memory.atlas.zoneKey, memory.atlas.stageFilter, decisions],
  );
  const visibleRows = useMemo(
    () => visibleRowKeys(rows, memory.table, memory.atlas.fieldsMode),
    [rows, memory.table, memory.atlas.fieldsMode],
  );
  const plan = useMemo(
    () => syncPlan(authority, page.zones, staged),
    [authority, page.zones, staged],
  );
  const review = useMemo(() => {
    const zoneKey = memory.atlas.zoneKey;
    const zone = world.zones.find((item) => item.zone.guid === zoneKey);
    return zoneKey && zone?.savedReview
      ? {
          zone: zoneKey,
          data: zone.savedReview,
          flags: handle.work.doc?.reviewFlags?.[zoneKey] ?? [],
          source: "saved native" as const,
        }
      : null;
  }, [memory.atlas.zoneKey, world, handle.work.doc]);

  const entity = useCallback(
    (id: string) => {
      const edit = staged[id];
      const room = authority.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === id);
      return {
        hovered: memory.hover === id,
        selected: memory.atlas.cursor === id || memory.atlas.zoneKey === id,
        bound: room?.elementId !== null && room !== undefined,
        decided: Object.keys(decisions).some((key) => key.startsWith(`${id}::`)),
        staged: edit ?? null,
        dirty: edit !== undefined,
        conflict:
          edit !== undefined &&
          room !== undefined &&
          JSON.stringify(edit.base) !== JSON.stringify(roomEdit(room)),
      };
    },
    [staged, authority, memory.hover, memory.atlas.cursor, memory.atlas.zoneKey, decisions],
  );

  const stageEdit = useCallback(
    (id: string, next: RoomEdit) => {
      const room = authority.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === id);
      if (!room) return Promise.resolve(null);
      const kept = (handle.work.doc?.staged ?? []).filter((edit) => edit.roomId !== id);
      return handle.work.write([
        { path: ["staged"], value: [...kept, { roomId: id, base: roomEdit(room), next }] },
      ]);
    },
    [authority, handle.work],
  );

  const actions = useMemo(
    () => ({
      setSelection: (next: Partial<TakeoffSelection>) => setPage(next),
      setAtlasPage: (next: Partial<AtlasPageState>) =>
        setMemory((current) => ({ ...current, atlas: { ...current.atlas, ...next } })),
      setTableState: (table: MasterTableState) => patch({ table }),
      setTargeting: (next: Partial<TakeoffPageMemory["targeting"]>) =>
        setMemory((current) => ({ ...current, targeting: { ...current.targeting, ...next } })),
      hover: (id: string) => patch({ hover: id }),
      openPanel: (panel: "sync" | null) =>
        setPage({ panel, ...(panel === null ? { syncReview: null } : {}) }),
      openSync: () => handle.actions.sync.run(),
      rememberDir: (dir: string) =>
        setMemory((current) => ({
          ...current,
          recentDirs: [dir, ...current.recentDirs.filter((item) => item !== dir)].slice(0, 8),
        })),
      patchAdopt: (
        view: string,
        elementId: number,
        next: Partial<Pick<AdoptDraft, "checked" | "name" | "systemTag">>,
      ) =>
        void handle.work.write([
          {
            path: ["adoptPatches", `${view}:${elementId}`],
            value: { ...adoptPatches[`${view}:${elementId}`], ...next },
          },
        ]),
      patchRoom: (id: string, next: RoomEdit) => void stageEdit(id, next),
      decideRoom: (room: ModelRoom, flag: string, verdict: "accept" | "dismiss") =>
        void handle.work.write([{ path: ["decisions", `${room.guid}::${flag}`], value: verdict }]),
      flagReview: (key: string) => {
        if (review)
          void handle.work.write([
            { path: ["reviewFlags", review.zone], value: [...new Set([...review.flags, key])] },
          ]);
      },
      clearFailure: () => undefined,
      adoptSelected: () => handle.actions.adopt.run(),
      partition: () => handle.actions.partition.run(),
      refresh: () => handle.actions.refresh.run(),
      syncRhvac: () => handle.actions["commit-sync"].run(),
      launchRhvac: () => handle.actions.launch.run(),
      retryRhvac: () => handle.actions["retry-r10"].run(),
    }),
    [handle.actions, handle.work, adoptPatches, review, patch, stageEdit, setPage],
  );

  return {
    handle,
    manifest,
    savedCapture: capture,
    source: capture ? ("saved" as const) : ("live" as const),
    readOnly: capture !== undefined,
    world,
    snapshot,
    geometryObservation: observed<TakeoffObservation>(observation),
    candidates,
    adoptRows,
    atlasRows: rows,
    visibleRows,
    syncPlan: plan,
    review,
    entity,
    operations: (handle.readings.receipts ?? { state: "absent" }) as Reading<
      readonly ActionStatus[]
    >,
    staged,
    pendingStaging: staged,
    busy: handle.busy,
    failure: handle.failure,
    // Page memory, flattened: every view reads one name, not an atom.
    selection: { zones: page.zones, r10: page.r10 },
    views: page.views,
    zones: page.zones,
    dir: page.dir,
    r10Path: page.r10,
    stage: page.stage,
    zoneKey: memory.atlas.zoneKey,
    stageFilter: memory.atlas.stageFilter,
    level: memory.atlas.level,
    fieldsMode: memory.atlas.fieldsMode,
    planOpen: memory.atlas.planOpen,
    statsOpen: memory.atlas.statsOpen,
    cursor: memory.atlas.cursor,
    hover: memory.hover,
    atlasTableState: memory.table,
    decisions: decisions,
    panel: page.panel,
    recentDirs: memory.recentDirs,
    targetingOpen: memory.targeting.open,
    targetingLevel: memory.targeting.level,
    targetingQuery: memory.targeting.query,
    page: { ...memory, ...page },
    actions,
  };
}

export type TakeoffStore = ReturnType<typeof useTakeoffStore>;
export type { TakeoffReadingKey };
