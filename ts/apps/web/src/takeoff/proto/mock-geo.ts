import { mergeTakeoffLevels, parseTakeoffTsv } from "#/rhvac/takeoff";
import type {
  RhvacTakeoffData,
  RoomMap,
  TakeoffResidueShape,
  TakeoffRoomShape,
} from "#/rhvac/types";
import { containsEvenOdd } from "#/takeoff/model";

import {
  assistData,
  mockModel,
  STAGE_ORDER,
  type MockRoom,
  type MockModel,
  type MockZone,
  type RoomType,
} from "./mock";
import type { DeclaredZone } from "#/takeoff/model";

/* Private dev fixture (projectA): extract/map, declared zones, and Partition replay TSVs served
   at /rhvac-fixture by the vite dev server only (see vite.config.ts and .private/README.md).
   The extract JSON is UTF-8 with BOM; strip it before parsing. Inlined from the deleted
   `rhvac/fixture.ts` (fold 4): this is the only caller. */
const BASE = "/rhvac-fixture";

interface FixtureManifest {
  extract: string;
  roomMap: string;
  takeoff: string[];
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) throw new Error(`fixture ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const sha256 = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fetchJson = async <T>(path: string): Promise<T> => JSON.parse(await fetchText(path)) as T;

async function loadFixtureTakeoff(): Promise<RhvacTakeoffData> {
  const manifest = await fetchJson<FixtureManifest>("manifest.json");
  const [roomMap, ...tsvTexts] = await Promise.all([
    fetchJson<RoomMap>(manifest.roomMap),
    ...manifest.takeoff.map((name) => fetchText(name)),
  ]);
  const parsedLevels = tsvTexts.map((text) => parseTakeoffTsv(text));
  const hashes = await Promise.all(tsvTexts.map(sha256));
  return {
    levels: mergeTakeoffLevels(parsedLevels),
    roomMap,
    tsvSha256: Object.fromEntries(
      parsedLevels.map((level, index) => [level.levelName, hashes[index]!]),
    ),
  };
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const ROOM_NAMES: [RoomType, string][] = [
  ["great room", "Great Room"],
  ["kitchen", "Kitchen"],
  ["dining", "Dining"],
  ["primary bedroom", "Primary Bedroom"],
  ["bedroom", "Bedroom"],
  ["full bath", "Bath"],
  ["powder", "Powder"],
  ["office", "Study"],
  ["laundry", "Laundry"],
  ["exercise", "Gym"],
  ["hall", "Hall"],
  ["mechanical", "Mech"],
];

export interface GeoRoom extends MockRoom {
  outer: [number, number][] | null;
  holes: [number, number][][];
}

export interface GeoZone extends Omit<MockZone, "rooms"> {
  rooms: GeoRoom[];
  residues: TakeoffResidueShape[];
}

interface GeoWorld extends Omit<MockModel, "zones"> {
  zones: GeoZone[];
}

function zoneOf(zones: MockZone[], lane: string, x: number, y: number): MockZone | undefined {
  return zones.find(
    (z) => z.zone.lane.levelFragment === lane && containsEvenOdd(z.zone.loops, x, y),
  );
}

function laneOf(levelName: string): string | null {
  for (const frag of ["Lower", "Main", "Upper", "Attic"]) if (levelName.includes(frag)) return frag;
  return null;
}

function joinGeometry(world: MockModel, takeoff: RhvacTakeoffData): GeoWorld {
  const byZone = new Map<string, TakeoffRoomShape[]>();
  const residuesByZone = new Map<string, TakeoffResidueShape[]>();

  for (const level of takeoff.levels) {
    const lane = laneOf(level.levelName);
    if (!lane) continue;
    for (const shape of level.rooms) {
      if (shape.rejected) continue;
      const zone = zoneOf(world.zones, lane, shape.label[0], shape.label[1]);
      if (!zone) continue;
      (byZone.get(zone.zone.key) ?? byZone.set(zone.zone.key, []).get(zone.zone.key)!).push(shape);
    }
    for (const residue of level.residues) {
      const zone = zoneOf(world.zones, lane, residue.label[0], residue.label[1]);
      if (!zone) continue;
      (
        residuesByZone.get(zone.zone.key) ??
        residuesByZone.set(zone.zone.key, []).get(zone.zone.key)!
      ).push(residue);
    }
  }

  const zones: GeoZone[] = world.zones.map((z) => {
    const stageIdx = STAGE_ORDER.indexOf(z.stage);
    const shapes = byZone.get(z.zone.key) ?? [];
    if (stageIdx < 2 || shapes.length === 0)
      return {
        ...z,
        rooms: z.rooms.map((r) => ({ ...r, outer: null, holes: [] })),
        residues: [],
      };

    const runId = z.runs[z.runs.length - 1]?.runId ?? "run-2026-08-12-000";
    const bedrooms = 1 + (hash(z.zone.key) % 3);
    const rooms: GeoRoom[] = shapes
      .sort((a, b) => b.rawSqft - a.rawSqft)
      .map((shape, ri) => {
        const h = hash(z.zone.key + shape.id);
        const [type, base] = ROOM_NAMES[(h + ri) % ROOM_NAMES.length]!;
        const flags = stageIdx === 2 ? [...(shape.flags ?? [])] : [];
        const sqft = Math.round(shape.rawSqft);
        const drifted = z.stage === "drifted" && ri === 0;
        return {
          guid: `7a4e-room-${h.toString(16)}-${shape.id}`,
          name: base,
          type,
          sqft: drifted ? Math.round(sqft * 1.12) : sqft,
          ceilingFt: Math.round(shape.meanCeilingFt * 2) / 2,
          label: shape.label,
          flags,
          decisions:
            stageIdx >= 3 && (shape.flags?.length ?? 0) > 0
              ? (shape.flags ?? []).map((flag) => ({
                  flag,
                  verb: (h >>> 2) % 5 === 0 ? ("dismiss" as const) : ("accept" as const),
                  at: "2026-08-12T14:30:00Z",
                  runId,
                }))
              : [],
          provenance: { runId, sourceSqft: sqft },
          r10:
            stageIdx >= 5
              ? {
                  identifier: 100 + (h % 400),
                  syncedAt: "2026-08-13T09:12:00Z",
                  lastSyncedSqft: sqft,
                }
              : null,
          data: stageIdx >= 4 ? assistData(type, sqft, bedrooms) : null,
          outer: shape.outer,
          holes: shape.holes,
        };
      });

    return { ...z, rooms, residues: residuesByZone.get(z.zone.key) ?? [] };
  });

  return { ...world, zones };
}

export const loadMockGeo = async (): Promise<GeoWorld> => {
  const [zones, takeoff] = await Promise.all([
    fetchJson<DeclaredZone[]>("zones.json"),
    loadFixtureTakeoff(),
  ]);
  return joinGeometry(mockModel(zones), takeoff);
};
