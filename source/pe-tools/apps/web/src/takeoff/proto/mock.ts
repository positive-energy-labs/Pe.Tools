/**
 * Development fixture data retained behind the explicit /takeoffs fixture adapter.
 *
 * Deterministic synthesis over the real project-a zone fixture so every variant judges the same
 * dense, plausible mid-project state: some zones untouched, some mid-review, some synced, one
 * drifted, one system over the 32k Btu/hr sensible cap. Nothing here is authoritative or live.
 * Rooms carry label points + areas, not polygons — round 1 judges UX shape, not room geometry.
 */
import { buildZones, containsEvenOdd, type Zone } from "#/takeoff/model";

// ── Deterministic PRNG (mulberry32 seeded per zone key) ─────────────────────

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

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** Mock lifecycle stage — richer than the derived ZoneStage on purpose: the progress-tracking
 *  dimension of the exploration needs states worth rendering. */
type MockStage =
  | "declared" // drawn, no tags typed
  | "registered" // tags resolved against the registry
  | "partitioned" // rooms materialized, decisions open
  | "reviewed" // decision queue empty
  | "data" // Manual J data entered, not yet exported
  | "synced" // .r10 in sync
  | "drifted"; // hand-edit drift against accepted state since last sync

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

// ── Shapes ──────────────────────────────────────────────────────────────────

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
  /** Label point inside the zone, model feet — render rooms as dots/chips, not polygons. */
  label: [number, number];
  /** Open detector flags — each is one row in the decision queue. */
  flags: string[];
  /** Write-through decisions already taken (provenance of review). */
  decisions: MockDecision[];
  provenance: { runId: string; sourceSqft: number };
  /** .r10 linkage — null until first export. lastSyncedSqft ≠ sqft means geometry drifted since. */
  r10: { identifier: number; syncedAt: string; lastSyncedSqft: number } | null;
  /** Manual J data (assist-derived) — null until step 5. */
  data: MockRoomData | null;
}

interface MockRun {
  runId: string;
  at: string;
  /** Rebind census — the accounting-closure story of one partition run. */
  created: number;
  rebound: number;
  held: number;
  orphaned: number;
  declaredSqft: number;
  roomSqft: number;
  claimedWallSqft: number;
  excludedSqft: number;
}

export interface MockZone {
  zone: Zone;
  stage: MockStage;
  /** System tags typed on the Zoning Region. */
  tags: string[];
  name: string;
  rooms: MockRoom[];
  heldSqft: number;
  runs: MockRun[];
  /** Hand-edit drift vs accepted state, sqft (only meaningful on "drifted"). */
  driftSqft: number;
}

interface MockSystem {
  guid: string;
  tag: string;
  zoneKeys: string[];
  sensibleBtuh: number;
  latentBtuh: number;
  /** Firm law: sensible ≤ 32,000 Btu/hr per zone/system (equipment constraint). */
  overCap: boolean;
}

export interface MockWorld {
  zones: MockZone[];
  systems: MockSystem[];
  r10Path: string;
  docName: string;
}

export const SENSIBLE_CAP_BTUH = 32_000;

// ── Assists (README step 5, deterministic) ──────────────────────────────────

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

// ── World synthesis ─────────────────────────────────────────────────────────

/** A grid-sampled interior point of the zone, for room labels. */
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

export function mockWorld(): MockWorld {
  const zones = buildZones();
  let sysCounter = 0;
  let identifier = 100;
  let parityRoomPending = true;
  const systems = new Map<string, MockSystem>();

  const mockZones: MockZone[] = zones.map((zone, zi) => {
    const rand = mulberry32(hash(zone.key));
    // Stage distribution: earlier levels are further along, a few stragglers everywhere.
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

    // Tags: 1 system usually, occasionally 2 (merged legend entry, "FC-8, FC-13").
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
              claimedWallSqft: Math.round(zone.declaredSqft - roomSqft - heldSqft),
              excludedSqft: 0,
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
