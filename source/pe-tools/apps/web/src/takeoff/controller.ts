/**
 * Takeoffs controller: route projections and dependent transitions.
 *
 * The owner, the registry, the conflict banner, refusal plumbing, the Target resolution and the
 * host caller all live in `useRoute`; action semantics live in `takeoff/actions.ts`. This file
 * projects the document into Takeoffs views and owns cleanup when target or scope changes.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  CandidateRegion,
  Reading,
  RouteStatePatch,
  StagedRoomEdit,
  TakeoffCapture,
  TakeoffSnapshot,
  TakeoffObservation,
} from "@pe/agent-contracts";
import {
  stagedAdoptChoices,
  stagedDecisions,
  stagedReviewFlags,
  stagedTakeoffEdits,
  takeoffDecisionAddress,
  takeoffDecisionKey,
  takeoffEditAddress,
  takeoffEditPatches,
  takeoffFlagToggle,
  transitionPatches,
} from "@pe/agent-contracts";

import type { CellWire } from "#/components/lang/band";
import { previousOf } from "#/readings";
import { useRoute } from "#/route/use-route";
import { snapshotOfObservation, syncPlan, type TakeoffReadingKey } from "#/takeoff/actions";
import { manifest } from "#/takeoff/manifest";
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
  readonly r10: string;
  readonly stage: "adopt" | "audit" | "sync";
}

export interface TakeoffNavigation {
  readonly level: string;
  readonly zone: string | null;
  readonly room: string | null;
}

export const EMPTY_TAKEOFF_SELECTION: TakeoffSelection = {
  views: [],
  zones: [],
  r10: "",
  stage: "adopt",
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

/* ── Pure projections ──────────────────────────────────────────────────────── */

const EMPTY_WORLD: TakeoffModel = { docName: "", r10Path: null, lanes: [], zones: [], systems: [] };

/**
 * An edit's staged rung needs its room's base (what sync compares against), which only a person
 * writes. Staging an edit cell — typing, or accepting Pea's proposal — carries the base when the
 * room has none yet, read from the authoritative world.
 */
export function withEditBases(
  doc: { bases: Readonly<Record<string, unknown>> },
  world: { zones: readonly { rooms: readonly ModelRoom[] }[] },
  patches: RouteStatePatch[],
): RouteStatePatch[] {
  const rooms = new Set(
    patches
      .filter((patch) => patch.path[0] === "edits" && patch.path[2] === "staged")
      .map((patch) => takeoffEditAddress(String(patch.path[1])).roomId),
  );
  const bases = [...rooms].flatMap((roomId) => {
    const room = world.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === roomId);
    // not a cell: bases
    return doc.bases[roomId] || !room ? [] : [{ path: ["bases", roomId], value: roomEdit(room) }];
  });
  return [...bases, ...patches];
}

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
  fieldsMode: "columns" | "panel",
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
  page: { zoneKey: string | null; stageFilter: TakeoffModel["zones"][number]["stage"] | null },
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
      const open = room.flags.filter(
        (flag) => decisions[takeoffDecisionKey(room.guid, flag)] === undefined,
      );
      return { zone, room, open, state: atlasRoomState(room, open.length) };
    }),
  );
}

export function visibleRowKeys(
  rows: readonly AtlasRow[],
  state: import("#/components/master-table/model").TableState,
  fieldsMode: "columns" | "panel",
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

/* ── One route handle plus Takeoffs projections and transitions ───────────── */

const observed = <T>(reading: Reading<unknown> | undefined): T | undefined =>
  reading === undefined
    ? undefined
    : reading.state === "ready"
      ? (reading.observation as T)
      : (previousOf(reading) as T | undefined);

export function useTakeoffsController(options: {
  target?: string;
  /** The thread whose head is the target store (a chat pane). */
  thread?: string;
  work?: string;
  savedCapture?: TakeoffCapture;
  navigation?: {
    value: TakeoffNavigation;
    set: (next: Partial<TakeoffNavigation>) => void;
  };
}) {
  const handle = useRoute(manifest, {
    target: options.target ? (options.target as never) : null,
    ...(options.work !== undefined ? { work: options.work } : {}),
    ...(options.thread ? { thread: options.thread } : {}),
  });
  const [page, setPage] = handle.page;
  const [localNavigation, setLocalNavigation] = useState<TakeoffNavigation>({
    level: "",
    zone: null,
    room: null,
  });
  const navigation = options.navigation?.value ?? localNavigation;
  const setNavigation = useCallback(
    (next: Partial<TakeoffNavigation>) => {
      if (options.navigation) options.navigation.set(next);
      else setLocalNavigation((current) => ({ ...current, ...next }));
    },
    [options.navigation],
  );
  // Hover is shared by the table and plan, but lasts only for this controller mount.
  const [hover, setHover] = useState("");

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
  // The person's staged cells only; Pea's proposals are not drawn here yet (interaction's cutover).
  const staged = useMemo(
    (): Record<string, StagedRoomEdit> =>
      handle.work.doc ? stagedTakeoffEdits(handle.work.doc) : {},
    [handle.work.doc],
  );
  const world = useMemo(() => stagedModel(authority, staged), [authority, staged]);
  const candidates = observed<TakeoffSnapshot>(snapshot)?.zoneFrs;
  const adoptPatches = useMemo(
    () => (handle.work.doc ? stagedAdoptChoices(handle.work.doc) : {}),
    [handle.work.doc],
  );
  const decisions = useMemo(
    () => (handle.work.doc ? stagedDecisions(handle.work.doc) : {}),
    [handle.work.doc],
  );
  const adoptRows = useMemo(
    () => (candidates ? adoptDrafts(candidates, adoptPatches) : null),
    [candidates, adoptPatches],
  );
  const rows = useMemo(
    () => atlasRows(world, { zoneKey: navigation.zone, stageFilter: page.stageFilter }, decisions),
    [world, navigation.zone, page.stageFilter, decisions],
  );
  const plan = useMemo(
    () => syncPlan(authority, page.zones, staged, decisions),
    [authority, page.zones, staged, decisions],
  );
  const review = useMemo(() => {
    const zoneKey = navigation.zone;
    const zone = world.zones.find((item) => item.zone.guid === zoneKey);
    return zoneKey && zone?.savedReview
      ? {
          zone: zoneKey,
          data: zone.savedReview,
          flags: handle.work.doc ? (stagedReviewFlags(handle.work.doc)[zoneKey] ?? []) : [],
          source: "saved native" as const,
        }
      : null;
  }, [navigation.zone, world, handle.work.doc]);

  const entity = useCallback(
    (id: string) => {
      const edit = staged[id];
      const room = authority.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === id);
      return {
        hovered: hover === id,
        selected: navigation.room === id || navigation.zone === id,
        bound: room?.elementId !== null && room !== undefined,
        decided: Object.keys(decisions).some((key) => takeoffDecisionAddress(key).roomGuid === id),
        staged: edit ?? null,
        dirty: edit !== undefined,
        conflict:
          edit !== undefined &&
          room !== undefined &&
          JSON.stringify(edit.base) !== JSON.stringify(roomEdit(room)),
      };
    },
    [staged, authority, hover, navigation.room, navigation.zone, decisions],
  );

  const stageEdit = useCallback(
    (id: string, next: RoomEdit) => {
      const room = authority.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === id);
      if (!room || !handle.work.doc) return Promise.resolve(null);
      return handle.work.write(takeoffEditPatches(handle.work.doc, id, roomEdit(room), next));
    },
    [authority, handle.work],
  );

  const actions = useMemo(
    () => ({
      chooseViews: (views: readonly string[]) => {
        const allowed = new Set(
          world.zones
            .filter((zone) => views.includes(zone.zone.lane.view))
            .map((zone) => zone.zone.guid),
        );
        setPage({
          views,
          zones: page.zones.filter((zone) => allowed.has(zone)),
          panel: null,
          syncReview: null,
        });
        setNavigation({ level: "", zone: null, room: null });
      },
      chooseZones: (zones: readonly string[]) => {
        const clearsFocus = navigation.zone !== null && !zones.includes(navigation.zone);
        setPage({
          zones,
          panel: null,
          syncReview: null,
        });
        if (clearsFocus) setNavigation({ zone: null, room: null });
      },
      chooseR10: (r10: string) => setPage({ r10, panel: null, syncReview: null }),
      chooseStage: (stage: TakeoffSelection["stage"]) =>
        setPage({ stage, panel: null, syncReview: null }),
      filterStage: (stageFilter: typeof page.stageFilter) => {
        setPage({ stageFilter });
        setNavigation({ zone: null, room: null });
      },
      chooseLevel: (level: string) => setNavigation({ level, zone: null, room: null }),
      chooseZone: (zone: string | null, level?: string) => {
        const changesScope = zone !== null && !page.zones.includes(zone);
        setNavigation({
          zone,
          room: null,
          ...(level === undefined ? {} : { level }),
        });
        if (changesScope) setPage({ zones: [zone], panel: null, syncReview: null });
      },
      chooseRoom: (room: string | null, level?: string) =>
        setNavigation({ room, ...(level === undefined ? {} : { level }) }),
      focusRoom: (zone: string, room: string, level: string) => {
        const changesScope = !page.zones.includes(zone);
        setNavigation({ zone, room, level });
        if (changesScope) setPage({ zones: [zone], panel: null, syncReview: null });
      },
      clearRoomScope: () => setNavigation({ zone: null, room: null }),
      resetTarget: () => {
        setPage({
          ...EMPTY_TAKEOFF_SELECTION,
          stageFilter: null,
          panel: null,
          syncReview: null,
        });
        setNavigation({ level: "", zone: null, room: null });
      },
      hover: setHover,
      openPanel: (panel: "sync" | null) =>
        setPage({ panel, ...(panel === null ? { syncReview: null } : {}) }),
      patchAdopt: (
        view: string,
        elementId: number,
        next: Partial<Pick<AdoptDraft, "checked" | "name" | "systemTag">>,
      ) =>
        void handle.work.write(
          transitionPatches(
            ["adopt"],
            `${view}:${elementId}`,
            {},
            {
              kind: "stage",
              rung: { value: { ...adoptPatches[`${view}:${elementId}`], ...next } },
            },
          ),
        ),
      patchRoom: (id: string, next: RoomEdit) => void stageEdit(id, next),
      decideRoom: (room: ModelRoom, flag: string, verdict: "accept" | "dismiss") =>
        void handle.work.write(
          transitionPatches(
            ["decisions"],
            takeoffDecisionKey(room.guid, flag),
            {},
            {
              kind: "stage",
              rung: { value: verdict },
            },
          ),
        ),
      // Flag stages the shape's cell; unflag unstages it (the old union could never unflag).
      flagReview: (key: string) => {
        if (review && handle.work.doc)
          void handle.work.write(takeoffFlagToggle(handle.work.doc, review.zone, key));
      },
    }),
    [
      handle.actions,
      handle.work,
      adoptPatches,
      review,
      stageEdit,
      setPage,
      setNavigation,
      world,
      page,
      navigation,
    ],
  );

  // THE FOUR CELL FAMILIES (the takeoffs cutover): each a trichotomy cell record, drawn through
  // the kit with the contract's transitions. An edit's staged rung needs its room's base (what
  // sync compares against), which only a person writes: a stage of an edit cell (typing, or
  // accepting Pea's proposal) carries the base when the room has none yet.
  const doc = handle.work.doc;
  const cells = {
    edits: doc?.edits ?? {},
    adopt: doc?.adopt ?? {},
    decisions: doc?.decisions ?? {},
    reviewFlags: doc?.reviewFlags ?? {},
  };
  const wire = (segment: keyof typeof cells): CellWire => ({
    segment,
    revision: handle.work.revision,
    write: (patches, expectedRevision) =>
      handle.work.write(
        segment === "edits" && doc ? withEditBases(doc, authority, patches) : patches,
        expectedRevision,
      ),
  });
  const wires = {
    edits: wire("edits"),
    adopt: wire("adopt"),
    decisions: wire("decisions"),
    reviewFlags: wire("reviewFlags"),
  };

  return {
    handle,
    cells,
    wires,
    savedCapture: capture,
    source: capture ? ("saved" as const) : ("live" as const),
    target:
      handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
        ? JSON.stringify({ kind: "open", ref: handle.resolution.target.ref })
        : (options.target ?? ""),
    readOnly: capture !== undefined,
    world,
    snapshot,
    adoptRows,
    atlasRows: rows,
    syncPlan: plan,
    review,
    entity,
    staged,
    busy: handle.busy,
    failure: handle.failure,
    // Page state, flattened: every view reads one route-owned name.
    selection: { zones: page.zones, r10: page.r10 },
    views: page.views,
    zones: page.zones,
    r10Path: page.r10,
    stage: page.stage,
    zoneKey: navigation.zone,
    stageFilter: page.stageFilter,
    level: navigation.level,
    cursor: navigation.room,
    decisions: decisions,
    panel: page.panel,
    syncReview: page.syncReview,
    actions,
  };
}

export type TakeoffsController = ReturnType<typeof useTakeoffsController>;
export type { TakeoffReadingKey };
