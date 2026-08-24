/**
 * PROTOTYPE — mock world v2: the round-1 mock joined with REAL room geometry.
 *
 * Round-1 verdict: real shapes/positions are critical for understanding and identity-at-a-glance.
 * The rhvac fixture carries the actual project-a Partition replay per level (TakeoffRoomShape with
 * real outer loops, labels, and detector flags). This module assigns those shapes to mock zones
 * by label containment and rebuilds each covered zone's rooms from them — real geometry + real
 * flags, synthetic lifecycle metadata (stage, decisions, Manual J data, .r10 links) as before.
 * Zones the fixture doesn't cover keep their synthetic dot-rooms (outer stays null).
 */
import { loadFixtureTakeoff } from "#/rhvac/fixture";
import type { RhvacTakeoffData, TakeoffResidueShape, TakeoffRoomShape } from "#/rhvac/types";
import { containsEvenOdd } from "#/takeoff/model";

import {
  assistData,
  mockWorld,
  STAGE_ORDER,
  type MockRoom,
  type MockWorld,
  type MockZone,
  type RoomType,
} from "./mock";

// Same deterministic hash as mock.ts (kept private there).
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

/** MockRoom plus real geometry when the fixture covers it. */
export interface GeoRoom extends MockRoom {
  /** Real detector outer loop, model feet — null for zones the fixture doesn't cover. */
  outer: [number, number][] | null;
  holes: [number, number][][];
}

export interface GeoZone extends Omit<MockZone, "rooms"> {
  rooms: GeoRoom[];
  /** Real held/void residue shapes that land inside this zone. */
  residues: TakeoffResidueShape[];
}

export interface GeoWorld extends Omit<MockWorld, "zones"> {
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

export function joinGeometry(world: MockWorld, takeoff: RhvacTakeoffData): GeoWorld {
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
    // Rooms only exist from "partitioned" on; a covered zone rebuilds them from real shapes.
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

export const loadMockWorldGeo = async (): Promise<GeoWorld> =>
  joinGeometry(mockWorld(), await loadFixtureTakeoff());
