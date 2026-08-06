/**
 * Ambiguity-flag resolutions — the durable, replayable record of the human
 * decisions the detector refused to make (see eval/rhvac/FLAGS-UI.md).
 *
 * A resolutions sidecar is deterministic JSON (no timestamps): applied to the
 * same parsed takeoff it always yields the same polygons, so it survives
 * reload and replays against re-runs. The C# candidate builder consumes the
 * same sidecar before .r10 export, so accepted flags and split polygons feed
 * candidate generation without changing the source TSVs.
 *
 * Persistence is localStorage per takeoff source plus downloadable JSON; the
 * `rhvac.takeoff-resolutions` host op (src/host/rhvac.ts) persists the same
 * shape as `<dir>/takeoff-resolutions.json`.
 */
import { candidateKey, type TakeoffLevel, type TakeoffRoomShape } from "#/rhvac/types";
import {
  sortRhvacResolutions,
  type RhvacResolutionsFile,
  type RhvacTakeoffResolution,
} from "@pe/host-contracts/operation-types";
export { sortRhvacResolutions as sortResolutions } from "@pe/host-contracts/operation-types";

// ── sidecar schema ───────────────────────────────────────────────────────────

/** Split chord endpoints, model coordinates (feet, Y up — the TSV frame). */
export type SplitParams = NonNullable<RhvacTakeoffResolution["params"]>;
export type FlagResolution = RhvacTakeoffResolution;
export type ResolutionsFile = RhvacResolutionsFile;

export interface ResolutionApplyResult {
  levels: TakeoffLevel[];
  applied: number;
  remapped: number;
  orphaned: number;
}

/** Replace any prior resolution of the same (candidateKey, flag), keep the rest. */
export const upsertResolution = (
  resolutions: FlagResolution[],
  next: FlagResolution,
): FlagResolution[] =>
  sortRhvacResolutions([
    ...resolutions.filter((r) => r.candidateKey !== next.candidateKey || r.flag !== next.flag),
    next,
  ]);

// ── applying resolutions to parsed levels ────────────────────────────────────

/**
 * Pure and idempotent: v1 resolves by key only; v2 verifies the key against its
 * anchor, remaps by same-level containment, and accounts for every orphan.
 * A split's source room is gone on the second pass, so apply(apply(x)) === apply(x). Splits replace the room
 * with `<id>.a` / `<id>.b` children (larger area = .a); children inherit the
 * room's other unresolved flags but never open-plan-merge — the split IS its
 * resolution. Nested splits (splitting a child) are deferred.
 */
export function applyResolutions(
  levels: TakeoffLevel[],
  resolutions: FlagResolution[],
  version: ResolutionsFile["version"] = 1,
): ResolutionApplyResult {
  if (resolutions.length === 0) return { levels, applied: 0, remapped: 0, orphaned: 0 };
  const rooms = levels.flatMap((level) =>
    level.rooms.map((room) => ({
      levelName: level.levelName,
      key: candidateKey(level.levelName, room.id),
      room,
    })),
  );
  const byKey = new Map<string, FlagResolution[]>();
  const splitTargets = new Set<string>();
  let applied = 0;
  let remapped = 0;
  let orphaned = 0;
  for (const resolution of resolutions) {
    const exact = rooms.find((candidate) => candidate.key === resolution.candidateKey);
    let target = exact;
    let wasRemapped = false;
    if (version === 2 && !resolution.anchor) {
      orphaned++;
      continue;
    }
    if (version === 2) {
      const validExact =
        exact &&
        pointInShape(resolution.anchor!.label, exact.room) &&
        Math.abs(exact.room.rawSqft - resolution.anchor!.sqft) <= resolution.anchor!.sqft * 0.2;
      if (!validExact) {
        const separator = resolution.candidateKey.lastIndexOf(":");
        const levelName = separator < 0 ? "" : resolution.candidateKey.slice(0, separator);
        target = rooms.find(
          (candidate) =>
            candidate.levelName === levelName &&
            pointInShape(resolution.anchor!.label, candidate.room),
        );
        wasRemapped = Boolean(target);
      }
    }
    if (!target) {
      orphaned++;
      continue;
    }
    if (
      resolution.action === "split" &&
      (!resolution.params ||
        splitTargets.has(target.key) ||
        !splitShape(target.room, resolution.params.a, resolution.params.b))
    ) {
      orphaned++;
      continue;
    }
    if (resolution.action === "split") splitTargets.add(target.key);
    if (wasRemapped) remapped++;
    else applied++;
    const list = byKey.get(target.key) ?? [];
    list.push(resolution);
    byKey.set(target.key, list);
  }

  const resolved = levels.map((level) => ({
    ...level,
    rooms: level.rooms.flatMap((room) => {
      const forRoom = byKey.get(candidateKey(level.levelName, room.id));
      if (!forRoom) return [room];

      const accepted = new Set(forRoom.filter((r) => r.action === "accept").map((r) => r.flag));
      const split = forRoom.find((r) => r.action === "split" && r.params);
      const remaining = (room.flags ?? []).filter((f) => !accepted.has(f));

      if (split) {
        const halves = splitShape(room, split.params!.a, split.params!.b);
        if (halves) {
          const childFlags = remaining.filter((f) => f !== split.flag);
          return halves.map((half) => ({
            ...half,
            ...(childFlags.length > 0 ? { flags: childFlags } : {}),
          }));
        }
      }
      if (remaining.length === (room.flags?.length ?? 0)) return [room];
      const { flags: _dropped, ...rest } = room;
      return [remaining.length > 0 ? { ...rest, flags: remaining } : rest];
    }),
  }));
  return { levels: resolved, applied, remapped, orphaned };
}

// ── split geometry ───────────────────────────────────────────────────────────

const ringArea = (ring: [number, number][]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
};

const ringPerimeter = (ring: [number, number][]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    sum += Math.hypot(x1 - x0, y1 - y0);
  }
  return sum;
};

const pointInRing = (p: readonly [number, number], ring: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = true;
  }
  return inside;
};

const pointInShape = (point: readonly [number, number], room: TakeoffRoomShape): boolean =>
  pointInRing(point, room.outer) && !room.holes.some((hole) => pointInRing(point, hole));

export interface RingSnap {
  /** Edge index i: the snapped point lies on ring[i] → ring[i+1]. */
  edge: number;
  /** Parameter along that edge, 0..1. */
  t: number;
  point: [number, number];
}

/** Closest point on the ring's boundary to p — how raw clicks become deterministic chord endpoints. */
export function nearestOnRing(ring: [number, number][], p: readonly [number, number]): RingSnap {
  let best: RingSnap = { edge: 0, t: 0, point: ring[0]! };
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / lenSq));
    const point: [number, number] = [ax + t * dx, ay + t * dy];
    const dist = Math.hypot(p[0] - point[0], p[1] - point[1]);
    if (dist < bestDist) {
      bestDist = dist;
      best = { edge: i, t, point };
    }
  }
  return best;
}

/** Ring path from snap A forward (ring order) to snap B, inclusive of both snapped points. */
function walkBetween(ring: [number, number][], from: RingSnap, to: RingSnap): [number, number][] {
  const out: [number, number][] = [from.point];
  if (from.edge === to.edge && to.t >= from.t) {
    out.push(to.point);
    return out;
  }
  let j = (from.edge + 1) % ring.length;
  for (let step = 0; step <= ring.length; step++) {
    out.push(ring[j]!);
    if (j === to.edge) break;
    j = (j + 1) % ring.length;
  }
  out.push(to.point);
  return out;
}

/** Drop consecutive points closer than epsilon (snap landed on a vertex). */
const dedupe = (ring: [number, number][]): [number, number][] =>
  ring.filter((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6;
  });

const MIN_HALF_SQFT = 1;

const holeArea = (holes: [number, number][][]): number =>
  holes.reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0);

const centroidOf = (ring: [number, number][]): [number, number] => {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) return ring[0]!;
  return [cx / (3 * area), cy / (3 * area)];
};

/**
 * Bisect a room by the chord a→b: both endpoints snap to the outer ring, the
 * ring is cut into the two boundary paths between them, and each path closes
 * through the chord. Deterministic — same inputs, same halves, `.a` is the
 * larger (tie: lexicographically smaller centroid). Holes go to whichever half
 * contains their centroid. Returns null when the chord is degenerate (same
 * point, sliver half under 1 sf) — the caller keeps the room unsplit.
 */
export function splitShape(
  room: TakeoffRoomShape,
  a: readonly [number, number],
  b: readonly [number, number],
): [TakeoffRoomShape, TakeoffRoomShape] | null {
  const ring = room.outer;
  if (ring.length < 3) return null;
  const snapA = nearestOnRing(ring, a);
  const snapB = nearestOnRing(ring, b);
  if (Math.hypot(snapA.point[0] - snapB.point[0], snapA.point[1] - snapB.point[1]) < 1e-6)
    return null;

  const half1 = dedupe(walkBetween(ring, snapA, snapB));
  const half2 = dedupe(walkBetween(ring, snapB, snapA));
  if (half1.length < 3 || half2.length < 3) return null;
  const area1 = Math.abs(ringArea(half1));
  const area2 = Math.abs(ringArea(half2));
  if (area1 < MIN_HALF_SQFT || area2 < MIN_HALF_SQFT) return null;

  const holes1: [number, number][][] = [];
  const holes2: [number, number][][] = [];
  for (const hole of room.holes)
    (pointInRing(centroidOf(hole), half1) ? holes1 : holes2).push(hole);

  const make = (
    suffix: "a" | "b",
    outer: [number, number][],
    holes: [number, number][][],
    grossArea: number,
  ): TakeoffRoomShape => ({
    id: `${room.id}.${suffix}`,
    rawSqft: grossArea - holeArea(holes),
    perimeterFt: ringPerimeter(outer),
    meanCeilingFt: room.meanCeilingFt,
    label: centroidOf(outer),
    outer,
    holes,
    splitFrom: room.splitFrom ?? room.id,
  });

  const c1 = centroidOf(half1);
  const c2 = centroidOf(half2);
  const firstIsA =
    area1 !== area2 ? area1 > area2 : c1[0] !== c2[0] ? c1[0] < c2[0] : c1[1] <= c2[1];
  return firstIsA
    ? [make("a", half1, holes1, area1), make("b", half2, holes2, area2)]
    : [make("a", half2, holes2, area2), make("b", half1, holes1, area1)];
}

// ── pending-flag queue derivation ────────────────────────────────────────────

export interface PendingFlag {
  levelName: string;
  levelIndex: number;
  roomId: string;
  candidateKey: string;
  flag: string;
  rawSqft: number;
  anchor: NonNullable<FlagResolution["anchor"]>;
}

/** Flags still awaiting a decision, in level order then area-descending (room order). */
export function pendingFlags(levels: TakeoffLevel[]): PendingFlag[] {
  return levels.flatMap((level, levelIndex) =>
    level.rooms.flatMap(
      (room) =>
        room.flags?.map((flag) => ({
          levelName: level.levelName,
          levelIndex,
          roomId: room.id,
          candidateKey: candidateKey(level.levelName, room.id),
          flag,
          rawSqft: room.rawSqft,
          anchor: { label: room.label, sqft: room.rawSqft },
        })) ?? [],
    ),
  );
}

// ── persistence (fixture lane: localStorage + downloadable JSON) ─────────────

const storageKey = (sourceKey: string) => `rhvac:takeoff-resolutions:${sourceKey}`;

export function loadStoredResolutions(sourceKey: string): ResolutionsFile | null {
  try {
    const raw = localStorage.getItem(storageKey(sourceKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResolutionsFile;
    return (parsed.version === 1 || parsed.version === 2) && Array.isArray(parsed.resolutions)
      ? { ...parsed, resolutions: sortRhvacResolutions(parsed.resolutions) }
      : null;
  } catch {
    return null;
  }
}

export function storeResolutions(sourceKey: string, file: ResolutionsFile | null): void {
  try {
    if (!file || file.resolutions.length === 0) localStorage.removeItem(storageKey(sourceKey));
    else localStorage.setItem(storageKey(sourceKey), JSON.stringify(file, null, 2));
  } catch {
    // storage unavailable — resolutions still live for this session.
  }
}

export const toResolutionsFile = (
  resolutions: readonly FlagResolution[],
  tsvSha256: Record<string, string>,
  version: ResolutionsFile["version"] = 2,
): ResolutionsFile => ({
  version,
  ...(version === 2 ? { tsvSha256: sortHashes(tsvSha256) } : {}),
  resolutions: sortRhvacResolutions(resolutions),
});

export const provenanceMismatch = (
  sidecar: ResolutionsFile | null,
  current: Record<string, string>,
): boolean =>
  sidecar?.version === 2 &&
  JSON.stringify(sidecar.tsvSha256 ?? {}) !== JSON.stringify(sortHashes(current));

const sortHashes = (hashes: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1)));
