import {
  takeoffDecisionKey,
  takeoffEditAddress,
  type CandidateRegion,
  type RouteStatePatch,
  type StagedRoomEdit,
} from "@pe/agent-contracts";
import {
  readZoneMeta,
  STAGE_ORDER,
  applyEdit,
  type RoomEdit,
  type TakeoffModel,
  type ModelRoom,
  type ModelZone,
} from "./world";
export interface TakeoffSelection {
  readonly views: readonly string[];
  readonly zones: readonly string[];
  readonly r10: string;
  readonly stage: "adopt" | "audit" | "sync";
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
  readonly zone: ModelZone;
  readonly room: ModelRoom;
  readonly state: AtlasRoomState;
  readonly open: readonly string[];
  readonly damage: string | null;
}

export interface AdoptDraft {
  readonly region: CandidateRegion;
  readonly view: string;
  readonly checked: boolean;
  readonly name: string;
  readonly systemTag: string;
}

/* ── Pure projections ──────────────────────────────────────────────────────── */

export const EMPTY_WORLD: TakeoffModel = {
  docName: "",
  r10Path: null,
  lanes: [],
  zones: [],
  systems: [],
};

/**
 * An edit's edit rung needs its room's base (what sync compares against), which only a person
 * writes. Staging an edit cell — typing, or accepting Pea's suggestion — carries the base when the
 * room has none yet, read from the authoritative world.
 */
export function withEditBases(
  doc: { bases: Readonly<Record<string, unknown>> },
  world: { zones: readonly { rooms: readonly ModelRoom[] }[] },
  patches: RouteStatePatch[],
): RouteStatePatch[] {
  const rooms = new Set(
    patches
      .filter((patch) => patch.path[0] === "edits" && patch.path[2] === "edit")
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

/** Authority geometry plus the edit room edits the Work doc carries. */
export function stagedModel(
  authority: TakeoffModel,
  edit: Readonly<Record<string, StagedRoomEdit>>,
): TakeoffModel {
  return {
    ...authority,
    zones: authority.zones.map((zone) => ({
      ...zone,
      rooms: zone.rooms.map((room) => applyEdit(room, edit[room.guid]?.next)),
    })),
  };
}

/** Every zone's rooms; the atlas narrows them by its plan scope and the table's one query. */
export function atlasRows(
  world: TakeoffModel,
  decisions: Readonly<Record<string, "accept" | "dismiss">>,
): readonly AtlasRow[] {
  return world.zones.flatMap((zone) =>
    zone.rooms.map((room) => {
      const open = room.flags.filter(
        (flag) => decisions[takeoffDecisionKey(room.guid, flag)] === undefined,
      );
      return {
        zone,
        room,
        open,
        state: atlasRoomState(room, open.length),
        damage: open.length ? "needs a call" : null,
      };
    }),
  );
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
