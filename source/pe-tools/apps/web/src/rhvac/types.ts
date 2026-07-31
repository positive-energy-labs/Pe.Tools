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

export interface TakeoffRoomShape {
  id: string;
  rawSqft: number;
  perimeterFt: number;
  meanCeilingFt: number;
  /** CCW outer loop, feet. */
  outer: [number, number][];
  holes: [number, number][][];
}

export interface TakeoffLevel {
  levelName: string;
  elevation: number;
  rooms: TakeoffRoomShape[];
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
}

export const candidateKey = (levelName: string, roomId: string) => `${levelName}:${roomId}`;
