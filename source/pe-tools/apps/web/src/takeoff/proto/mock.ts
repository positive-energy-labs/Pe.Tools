import { buildZones, containsEvenOdd, type DeclaredZone, type Zone } from "#/takeoff/model";

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type MockStage =
  | "declared"
  | "registered"
  | "partitioned"
  | "reviewed"
  | "data"
  | "synced"
  | "drifted";

export const STAGE_ORDER: MockStage[] = [
  "declared",
  "registered",
  "partitioned",
  "reviewed",
  "data",
  "synced",
  "drifted",
];

export type RoomType =
  | "bedroom"
  | "primary bedroom"
  | "full bath"
  | "powder"
  | "kitchen"
  | "dining"
  | "office"
  | "laundry"
  | "great room"
  | "exercise"
  | "mechanical"
  | "hall";

const ROOM_POOL: [RoomType, string][] = [
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

const FLAG_POOL = [
  "seedless",
  "suspect:narrow",
  "suspect:ceiling-variance",
  "low-evidence-boundary",
];

interface MockRoomData {
  people: number;
  lightingW: number;
  equipSensible: number;
  equipLatent: number;
  ventilationCfm: number;
}

interface MockDecision {
  flag: string;
  verb: "accept" | "dismiss";
  at: string;
  runId: string;
}

export interface MockRoom {
  guid: string;
  name: string;
  type: RoomType;
  sqft: number;
  ceilingFt: number;
  label: [number, number];
  flags: string[];
  decisions: MockDecision[];
  provenance: { runId: string; sourceSqft: number };
  r10: { identifier: number; syncedAt: string; lastSyncedSqft: number } | null;
  data: MockRoomData | null;
}

interface MockRun {
  runId: string;
  at: string;
  created: number;
  rebound: number;
  held: number;
  orphaned: number;
  declaredSqft: number;
  roomSqft: number;
  excludedSqft: number;
  voidSqft: number;
}

export interface MockZone {
  zone: Zone;
  stage: MockStage;
  tags: string[];
  name: string;
  rooms: MockRoom[];
  heldSqft: number;
  runs: MockRun[];
  driftSqft: number;
}

interface MockSystem {
  guid: string;
  tag: string;
  zoneKeys: string[];
  sensibleBtuh: number;
  latentBtuh: number;
  overCap: boolean;
}

export interface MockModel {
  zones: MockZone[];
  systems: MockSystem[];
  r10Path: string;
  docName: string;
}

export const SENSIBLE_CAP_BTUH = 32_000;

export function assistData(type: RoomType, sqft: number, bedroomsInZone: number): MockRoomData {
  const lightingW = Math.round(0.25 * sqft);
  const people = type === "primary bedroom" ? 2 : type === "bedroom" ? 1 : 0;
  const equip: Record<string, [number, number]> = {
    kitchen: [1800, 400],
    "full bath": [0, 500],
    laundry: [0, 600],
    powder: [0, 300],
    dining: [270, 270],
    office: [900, 0],
    exercise: [710, 1090],
  };
  const [equipSensible, equipLatent] = equip[type] ?? [0, 0];
  const ventilationCfm = Math.ceil(((bedroomsInZone + 1) * 7.5 + 0.03 * sqft) / 10) * 10;
  return { people, lightingW, equipSensible, equipLatent, ventilationCfm };
}

function interiorPoints(zone: Zone, n: number, rand: () => number): [number, number][] {
  const pts: [number, number][] = [];
  const { minX, minY, maxX, maxY } = zone.bounds;
  let guard = 0;
  while (pts.length < n && guard++ < 400) {
    const x = minX + rand() * (maxX - minX);
    const y = minY + rand() * (maxY - minY);
    if (containsEvenOdd(zone.loops, x, y)) pts.push([x, y]);
  }
  while (pts.length < n) pts.push([(minX + maxX) / 2, (minY + maxY) / 2]);
  return pts;
}

const ZONE_NAMES = [
  "Great Room",
  "Kitchen + Dining",
  "Primary Suite",
  "Guest Wing",
  "Study",
  "Lower Hall",
  "Gym",
  "Media",
  "Mudroom",
  "Loft",
  "Bunk Room",
  "Attic Suite",
];

/** Synthetic declared zones for the seed world: three per zoning view, sized to hit every mock stage.
 * Loops are sheet inches. Real declared zones come from the private fixture (zones.json) via mock-geo. */
export const SEED_ZONES: DeclaredZone[] = ["Lower", "Main", "Upper", "Attic"].flatMap((level, li) =>
  [
    [12, 20, "Transparent Cyan 4", "0,210,210"],
    [40, 30, "Transparent Magenta 2", "210,0,210"],
    [6, 6, "Transparent Yellow 1", null],
  ].map(([w, h, typeName, color], i) => {
    const x = 100 + i * 60;
    const y = 100 + li * 60;
    return {
      view: `Mechanical Zoning Plan - ${level} Level`,
      typeName: typeName as string,
      color: color as string | null,
      comments: null,
      loops: [
        [
          [x, y],
          [x + (w as number), y],
          [x + (w as number), y + (h as number)],
          [x, y + (h as number)],
        ],
      ],
    };
  }),
);

export function mockModel(declared: DeclaredZone[] = SEED_ZONES): MockModel {
  const zones = buildZones(declared);
  let sysCounter = 0;
  let identifier = 100;
  let parityRoomPending = true;
  const systems = new Map<string, MockSystem>();

  const mockZones: MockZone[] = zones.map((zone, zi) => {
    const rand = mulberry32(hash(zone.key));
    const roll = rand();
    const stage: MockStage =
      zone.declaredSqft < 60
        ? "declared"
        : roll < 0.12
          ? "declared"
          : roll < 0.24
            ? "registered"
            : roll < 0.45
              ? "partitioned"
              : roll < 0.58
                ? "reviewed"
                : roll < 0.72
                  ? "data"
                  : roll < 0.92
                    ? "synced"
                    : "drifted";

    const stageIdx = STAGE_ORDER.indexOf(stage);
    const name = ZONE_NAMES[zi % ZONE_NAMES.length]!;

    const tags: string[] = [];
    if (stageIdx >= 1) {
      const t1 = `FC-${++sysCounter}`;
      tags.push(t1);
      if (rand() < 0.15) tags.push(`FC-${++sysCounter}`);
    }

    // Rooms exist from "partitioned" on.
    const baseRoomCount =
      stageIdx >= 2 ? Math.max(1, Math.min(8, Math.round(zone.declaredSqft / 220))) : 0;
    // Keep the synthetic fallback's row count aligned with the real-geometry fixture.
    const roomCount =
      baseRoomCount + Number(parityRoomPending && baseRoomCount > 0 && baseRoomCount < 8);
    if (roomCount > baseRoomCount) parityRoomPending = false;
    const pts = interiorPoints(zone, roomCount, rand);
    const runId = `run-2026-08-${String(10 + (zi % 4)).padStart(2, "0")}-${(hash(zone.key) % 900) + 100}`;
    const bedroomsInZone = roomCount >= 3 ? 1 + (hash(zone.key) % 3) : 0;

    let remaining = zone.declaredSqft * (0.82 + rand() * 0.08);
    const rooms: MockRoom[] = pts.map((label, ri) => {
      const [type, base] = ROOM_POOL[(hash(zone.key + ri) + ri) % ROOM_POOL.length]!;
      const share = ri === roomCount - 1 ? remaining : remaining * (0.3 + rand() * 0.4);
      remaining -= share;
      const sqft = Math.max(28, Math.round(share));
      const flagged = stage === "partitioned" && rand() < 0.45;
      const flags = flagged ? [FLAG_POOL[(hash(zone.key + ri) >>> 3) % FLAG_POOL.length]!] : [];
      const decided = stageIdx >= 3 || (stage === "partitioned" && rand() < 0.3);
      const decisions: MockDecision[] =
        decided && rand() < 0.6
          ? [
              {
                flag: FLAG_POOL[(hash(zone.key + ri) >>> 5) % FLAG_POOL.length]!,
                verb: rand() < 0.7 ? "accept" : "dismiss",
                at: "2026-08-12T14:30:00Z",
                runId,
              },
            ]
          : [];
      const drifted = stage === "drifted" && ri === 0;
      return {
        guid: `7a4e-room-${hash(zone.key).toString(16)}-${String(ri).padStart(4, "0")}`,
        name: roomCount > 1 && type === "bedroom" ? `${base} ${ri}` : base,
        type,
        sqft: drifted ? Math.round(sqft * 1.12) : sqft,
        ceilingFt: 8 + Math.round(rand() * 4) / 2,
        label,
        flags,
        decisions,
        provenance: { runId, sourceSqft: sqft },
        r10:
          stageIdx >= 5
            ? { identifier: ++identifier, syncedAt: "2026-08-13T09:12:00Z", lastSyncedSqft: sqft }
            : null,
        data: stageIdx >= 4 ? assistData(type, sqft, bedroomsInZone) : null,
      };
    });

    const roomSqft = rooms.reduce((s, r) => s + r.sqft, 0);
    const heldSqft = stageIdx >= 2 ? Math.round(zone.declaredSqft * 0.03 * rand() * 2) : 0;
    const runs: MockRun[] =
      stageIdx >= 2
        ? [
            {
              runId,
              at: "2026-08-12T14:02:00Z",
              created: rooms.length,
              rebound: 0,
              held: heldSqft > 0 ? 1 : 0,
              orphaned: 0,
              declaredSqft: zone.declaredSqft,
              roomSqft,
              excludedSqft: Math.round(zone.declaredSqft - roomSqft - heldSqft),
              voidSqft: 0,
            },
          ]
        : [];
    if (stageIdx >= 3 && rand() < 0.4)
      runs.unshift({
        ...runs[0]!,
        runId: runId.replace("run-", "run-0"),
        at: "2026-08-11T10:40:00Z",
        created: Math.max(1, rooms.length - 1),
        rebound: 0,
      });

    for (const tag of tags) {
      const sys = systems.get(tag) ?? {
        guid: `5y5-${hash(tag)}`,
        tag,
        zoneKeys: [],
        sensibleBtuh: 0,
        latentBtuh: 0,
        overCap: false,
      };
      sys.zoneKeys.push(zone.key);
      sys.sensibleBtuh += Math.round((zone.declaredSqft / tags.length) * (10 + rand() * 6));
      sys.latentBtuh += Math.round((zone.declaredSqft / tags.length) * (2 + rand() * 2));
      sys.overCap = sys.sensibleBtuh > SENSIBLE_CAP_BTUH;
      systems.set(tag, sys);
    }

    return {
      zone,
      stage,
      tags,
      name,
      rooms,
      heldSqft,
      runs,
      driftSqft: stage === "drifted" ? Math.round(zone.declaredSqft * 0.04) : 0,
    };
  });

  return {
    zones: mockZones,
    systems: [...systems.values()],
    r10Path: "C:\\projects\\project-a\\projectA.local.r10",
    docName: "project-a Residence.rvt",
  };
}
