/**
 * RHVAC domain types — the extract-JSON shape produced by the .r10 reverse
 * engineering (eval/rhvac/project-a/oracle.extract.json is the reference fixture).
 * These types are the web-side mirror of the wave-2 `rhvac.*` host ops; keep
 * them in sync with the extract script rather than inventing fields.
 */

/** Wall directions, clockwise from north: 0=N … 7=NW. */
export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export interface RhvacWall {
  /** 1-based wall ordinal within the room — glass/doors point at this via wallReference. */
  index1: number;
  assembly: string;
  uValue: number;
  lengthFeet: number;
  heightFeet: number;
  /** 0=N .. 7=NW clockwise. */
  direction: number;
}

export interface RhvacGlass {
  assembly: string;
  uValue: number;
  widthFeet: number;
  heightFeet: number;
  /** 1-based ordinal into the room's walls array. */
  wallReference: number;
  shgc: number;
  occurrences: number;
}

export interface RhvacDoor {
  assembly: string;
  uValue: number;
  widthFeet: number;
  heightFeet: number;
  /** 1-based ordinal into the room's walls array. */
  wallReference: number;
}

export interface RhvacFloor {
  assembly: string;
  uValue: number;
  areaSquareFeet: number;
  exposedPerimeterFeet: number;
}

export interface RhvacRoof {
  assembly: string;
  uValue: number;
  areaSquareFeet: number;
  areaMultiplier: number;
}

/** Calculated outputs — read-only, valid only "as of last RHVAC calc". */
export interface RhvacRoomLoads {
  cfmSupplyCooling: number;
  cfmSupplyHeating: number;
  cfmSupplyActual: number;
  temperatureInDuct: number;
  registersCalculated: number;
}

export interface RhvacRoom {
  /** Autonumber primary key — distinct from the user-facing `number`. */
  identifier: number;
  number: number;
  name: string;
  systemNumber: number;
  zoneNumber: number;
  areaSquareFeet: number;
  ceilingHeightFeet: number;
  people: number;
  lightingWatts: number;
  equipmentSensibleBtuh: number;
  equipmentLatentBtuh: number;
  loads: RhvacRoomLoads;
  floors: RhvacFloor[];
  roofs: RhvacRoof[];
  walls: RhvacWall[];
  glass: RhvacGlass[];
  doors: RhvacDoor[];
}

/** System calc outputs — the extract carries ~35 calculated* fields; we type the displayed ones. */
export interface RhvacSystem {
  number: number;
  calculatedCoolingNetLoadPeak: number;
  calculatedCoolingRecommendedLoadPeak: number;
  calculatedHeatingLoad: number;
  calculatedHeatingLoadRecommended: number;
  calculatedActualSystemCFM: number;
  calculatedHeatingSupplyCFM: number;
}

export interface RhvacBuilding {
  areaSquareFeet: number;
  people: number;
  coolingLoadNetBtuh: number;
  coolingLoadRecommendedBtuh: number;
  heatingLoadBtuh: number;
  heatingLoadRecommendedBtuh: number;
}

export interface RhvacExtract {
  sourceFile: string;
  building: RhvacBuilding;
  systems: RhvacSystem[];
  rooms: RhvacRoom[];
}

/**
 * Backstop for extracts that predate the `identifier` PK — assign a stable
 * 1-based room-order fallback. The committed fixture and the rhvac.open op
 * both carry real identifiers now; this only fires on stale local extracts.
 */
export function normalizeExtract(raw: RhvacExtract): RhvacExtract {
  return {
    ...raw,
    rooms: raw.rooms.map((room, i) => ({
      ...room,
      identifier: (room as Partial<RhvacRoom>).identifier ?? i + 1,
    })),
  };
}

// ── Assembly catalog (rhvac.assemblies op / derived from the fixture) ────────

/** One pickable construction assembly — assemblies are never free-text-created from the web UI. */
export interface RhvacAssemblyOption {
  name: string;
  uValue: number;
  /** Glass only. */
  shgc?: number;
}

export interface RhvacAssemblyCatalog {
  walls: RhvacAssemblyOption[];
  glass: RhvacAssemblyOption[];
  doors: RhvacAssemblyOption[];
  floors: RhvacAssemblyOption[];
  roofs: RhvacAssemblyOption[];
}

// ── Takeoff plan snapshots (source of truth: RhvacCandidateBuilder.ParseTsv) ──

/**
 * Ambiguity flags emitted by the detector's Partition formulation (backward-
 * compatible `META flag <id>:<flag+flag>` TSV lines). The detector refuses to
 * guess intent — each flag awaits a one-touch human resolution in the plan UI.
 * Unknown kinds are preserved verbatim (forward-compatible).
 */
export const KNOWN_FLAG_KINDS = {
  "low-evidence-boundary": "boundary placed on weak evidence — accept or adjust",
  seedless: "space with no seed room — verify it is a real room",
} as const;

export type TakeoffFlagKind = keyof typeof KNOWN_FLAG_KINDS | (string & {});

// Retired shape-state flags can remain in old snapshots; they are not user decisions.
const LEGACY_STATE_FLAG_KINDS = new Set([
  "area-drift",
  "bridged-loop",
  "local-straightened",
  "ruled-seam",
  "unregularized",
]);

export const isDecisionFlag = (kind: string) => !LEGACY_STATE_FLAG_KINDS.has(kind);

export interface TakeoffRoomShape {
  id: string;
  rawSqft: number;
  perimeterFt: number;
  meanCeilingFt: number;
  /** Detector label point in model feet; stable geometric anchor for sidecar decisions. */
  label: [number, number];
  /** CCW outer loop, feet. */
  outer: [number, number][];
  holes: [number, number][][];
  /** Ambiguity flags, sorted; absent when the TSV predates flags or the room is clean. */
  flags?: TakeoffFlagKind[];
  /** Set on rooms produced by a resolved split — the original candidate id. */
  splitFrom?: string;
  /** Set on the survivor of a merge; the absorbed candidate id. */
  mergedFrom?: string;
  /** Rejected rooms remain renderable but are excluded by export mirrors. */
  rejected?: boolean;
  /** Native Revit geometry supersedes the detector shape with the same id. */
  native?: boolean;
}

export interface TakeoffResidueShape {
  id: string;
  reason: "border" | "crumb" | "rejected";
  claimed?: boolean;
  rawSqft: number;
  meanCeilingFt: number;
  label: [number, number];
  outer: [number, number][];
  holes: [number, number][][];
}

export interface TakeoffLevel {
  levelName: string;
  elevation: number;
  source: "detector" | "native";
  rooms: TakeoffRoomShape[];
  residues: TakeoffResidueShape[];
}

/** Curated rhvac-room ↔ takeoff-candidate map (eval/rhvac/<project>/room-map.json). */
export interface RoomMapMatch {
  oracleNumber: number;
  /** "<levelName>:<roomId>", e.g. "Level 1/Main Level:R12". */
  candidate: string;
}

export interface RoomMapSkip {
  oracleNumber: number;
  reason: string;
}

export interface RoomMap {
  matches: RoomMapMatch[];
  skip: RoomMapSkip[];
}

export interface RhvacTakeoffData {
  levels: TakeoffLevel[];
  roomMap: RoomMap;
  /** SHA-256 of each loaded TSV, keyed by parsed level name. */
  tsvSha256: Record<string, string>;
}

export const candidateKey = (levelName: string, roomId: string) => `${levelName}:${roomId}`;
