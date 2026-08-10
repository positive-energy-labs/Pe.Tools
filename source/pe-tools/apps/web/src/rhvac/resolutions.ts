/**
 * Ambiguity-flag resolutions — the durable, replayable record of the human
 * decisions the detector refused to make (see eval/rhvac/FLAGS-UI.md).
 *
 * A resolutions sidecar is deterministic JSON (no timestamps): applied to the
 * same parsed takeoff it always yields the same polygons, so it survives
 * reload and replays against re-runs. The C# candidate builder consumes the
 * same sidecar before .r10 export, so accepted flags and split polygons feed
 * candidate generation without changing the source TSVs; rejected rooms become
 * claimed residue so conserved gray geometry remains explicit in every mirror.
 *
 * Persistence is localStorage per takeoff source plus downloadable JSON; the
 * `rhvac.takeoff-resolutions` host op (src/host/rhvac.ts) persists the same
 * shape as `<dir>/takeoff-resolutions.json`.
 */
import {
  candidateKey,
  isDecisionFlag,
  type TakeoffLevel,
  type TakeoffResidueShape,
  type TakeoffRoomShape,
} from "#/rhvac/types";
import {
  sortRhvacResolutions,
  type RhvacResolutionsFile,
  type RhvacTakeoffResolution,
} from "@pe/host-contracts/operation-types";
export { sortRhvacResolutions as sortResolutions } from "@pe/host-contracts/operation-types";

// ── sidecar schema ───────────────────────────────────────────────────────────

/** Split chord endpoints, model coordinates (feet, Y up — the TSV frame). */
export type SplitParams = NonNullable<
  Extract<RhvacTakeoffResolution, { action: "split" }>["params"]
>;
export type MergeParams = Extract<RhvacTakeoffResolution, { action: "merge" }>["params"];
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
  const residues = levels.flatMap((level) =>
    level.residues.map((residue) => ({
      levelName: level.levelName,
      key: candidateKey(level.levelName, residue.id),
      residue,
    })),
  );
  const byKey = new Map<string, FlagResolution[]>();
  const splitTargets = new Set<string>();
  const mergeSources = new Set<string>();
  const mergedByTarget = new Map<string, TakeoffRoomShape>();
  const claimedResidues = new Set<string>();
  const promoted = new Map<string, TakeoffRoomShape[]>();
  let applied = 0;
  let remapped = 0;
  let orphaned = 0;

  const resolveCandidate = (
    key: string,
    anchor: FlagResolution["anchor"],
  ): { target: (typeof rooms)[number] | undefined; remapped: boolean } => {
    const exact = rooms.find((candidate) => candidate.key === key);
    if (exact?.room.native) return { target: undefined, remapped: false };
    if (version === 1) return { target: exact, remapped: false };
    if (!anchor) return { target: undefined, remapped: false };
    if (
      exact &&
      pointInShape(anchor.label, exact.room) &&
      Math.abs(exact.room.rawSqft - anchor.sqft) <= anchor.sqft * 0.2
    )
      return { target: exact, remapped: false };
    const separator = key.lastIndexOf(":");
    const levelName = separator < 0 ? "" : key.slice(0, separator);
    return {
      target: rooms.find(
        (candidate) =>
          !candidate.room.native &&
          candidate.levelName === levelName &&
          pointInShape(anchor.label, candidate.room),
      ),
      remapped: true,
    };
  };

  const resolveResidue = (
    key: string,
    anchor: FlagResolution["anchor"],
  ): { target: (typeof residues)[number] | undefined; remapped: boolean } => {
    const exact = residues.find((candidate) => candidate.key === key);
    if (version === 1) return { target: exact, remapped: false };
    if (!anchor) return { target: undefined, remapped: false };
    if (
      exact &&
      pointInResidue(anchor.label, exact.residue) &&
      Math.abs(exact.residue.rawSqft - anchor.sqft) <= anchor.sqft * 0.2
    )
      return { target: exact, remapped: false };
    const separator = key.lastIndexOf(":");
    const levelName = separator < 0 ? "" : key.slice(0, separator);
    return {
      target: residues.find(
        (candidate) =>
          candidate.levelName === levelName && pointInResidue(anchor.label, candidate.residue),
      ),
      remapped: true,
    };
  };

  for (const resolution of resolutions) {
    if (resolution.action === "claim-residue") {
      if (
        resolution.params.residueId !==
        resolution.candidateKey.slice(resolution.candidateKey.lastIndexOf(":") + 1)
      ) {
        orphaned++;
        continue;
      }
      const sourceResolution = resolveResidue(resolution.candidateKey, resolution.anchor);
      const source = sourceResolution.target;
      if (!source || claimedResidues.has(source.key)) {
        orphaned++;
        continue;
      }
      let wasRemapped = sourceResolution.remapped;
      if (resolution.params.into) {
        const targetResolution = resolveCandidate(resolution.params.into, resolution.params.anchor);
        const target = targetResolution.target;
        if (!target || target.levelName !== source.levelName || mergeSources.has(target.key)) {
          orphaned++;
          continue;
        }
        const residueRoom = residueToRoom(source.residue);
        const targetRoom = mergedByTarget.get(target.key) ?? target.room;
        const merged = mergeShapes(residueRoom, targetRoom, resolution.flag);
        if (!merged) {
          orphaned++;
          continue;
        }
        mergedByTarget.set(target.key, { ...merged, mergedFrom: targetRoom.mergedFrom });
        wasRemapped ||= targetResolution.remapped;
      } else {
        promoted.set(source.levelName, [
          ...(promoted.get(source.levelName) ?? []),
          residueToRoom(source.residue),
        ]);
      }
      claimedResidues.add(source.key);
      if (wasRemapped) remapped++;
      else applied++;
      continue;
    }
    const sourceResolution = resolveCandidate(resolution.candidateKey, resolution.anchor);
    const sourceCandidate = sourceResolution.target;
    if (!sourceCandidate) {
      orphaned++;
      continue;
    }

    if (resolution.action === "split") {
      const params = resolution.params;
      if (
        !params ||
        splitTargets.has(sourceCandidate.key) ||
        !splitShape(sourceCandidate.room, params.a, params.b)
      ) {
        orphaned++;
        continue;
      }
      splitTargets.add(sourceCandidate.key);
    } else if (resolution.action === "merge") {
      const survivorResolution = resolveCandidate(
        resolution.params.other,
        resolution.params.anchor,
      );
      const survivor = survivorResolution.target;
      if (
        !survivor ||
        survivor.key === sourceCandidate.key ||
        survivor.levelName !== sourceCandidate.levelName ||
        mergeSources.has(sourceCandidate.key) ||
        mergeSources.has(survivor.key)
      ) {
        orphaned++;
        continue;
      }
      const merged = mergeShapes(
        mergedByTarget.get(sourceCandidate.key) ?? sourceCandidate.room,
        mergedByTarget.get(survivor.key) ?? survivor.room,
        resolution.flag,
      );
      if (!merged) {
        orphaned++;
        continue;
      }
      mergeSources.add(sourceCandidate.key);
      mergedByTarget.delete(sourceCandidate.key);
      mergedByTarget.set(survivor.key, merged);
      if (survivorResolution.remapped) sourceResolution.remapped = true;
    }

    if (sourceResolution.remapped) remapped++;
    else applied++;
    if (resolution.action === "merge") continue;
    const list = byKey.get(sourceCandidate.key) ?? [];
    list.push(resolution);
    byKey.set(sourceCandidate.key, list);
  }

  const resolved = levels.map((level) => {
    const rejectedResidues: TakeoffResidueShape[] = [];
    return {
      ...level,
      rooms: level.rooms
        .flatMap((room) => {
          const key = candidateKey(level.levelName, room.id);
          if (mergeSources.has(key)) return [];
          const input = mergedByTarget.get(key) ?? room;
          const forRoom = byKey.get(key);
          if (!forRoom) return [input];

          const accepted = new Set(forRoom.filter((r) => r.action === "accept").map((r) => r.flag));
          const rejected = forRoom.some((r) => r.action === "reject");
          const split = forRoom.find(
            (r): r is Extract<FlagResolution, { action: "split" }> => r.action === "split",
          );
          const remaining = (input.flags ?? []).filter((f) => !accepted.has(f));

          if (rejected) {
            rejectedResidues.push({
              id: input.id,
              reason: "rejected",
              claimed: true,
              rawSqft: input.rawSqft,
              meanCeilingFt: input.meanCeilingFt,
              label: input.label,
              outer: input.outer,
              holes: input.holes,
            });
            return [];
          }

          if (split?.params) {
            const halves = splitShape(input, split.params.a, split.params.b);
            if (halves) {
              const childFlags = remaining.filter((f) => f !== split.flag);
              return halves.map((half) => ({
                ...half,
                ...(childFlags.length > 0 ? { flags: childFlags } : {}),
              }));
            }
          }
          if (remaining.length === (input.flags?.length ?? 0)) return [input];
          const { flags: _dropped, ...rest } = input;
          return [remaining.length > 0 ? { ...rest, flags: remaining } : rest];
        })
        .concat(promoted.get(level.levelName) ?? []),
      residues: level.residues
        .filter((residue) => !claimedResidues.has(candidateKey(level.levelName, residue.id)))
        .concat(rejectedResidues),
    };
  });
  return { levels: resolved, applied, remapped, orphaned };
}

const pointInResidue = (point: readonly [number, number], residue: TakeoffResidueShape): boolean =>
  pointInRing(point, residue.outer) && residue.holes.every((hole) => !pointInRing(point, hole));

export const residueToRoom = (residue: TakeoffResidueShape): TakeoffRoomShape => ({
  id: residue.id,
  rawSqft: residue.rawSqft,
  perimeterFt: ringPerimeter(residue.outer),
  meanCeilingFt: residue.meanCeilingFt,
  label: residue.label,
  outer: residue.outer,
  holes: residue.holes,
});

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

interface DirectedSegment {
  a: [number, number];
  b: [number, number];
}

const snapPoint = (point: readonly [number, number]): [number, number] =>
  point.map((value) => Math.round(value * 1e6) / 1e6) as [number, number];
const pointKey = (point: readonly [number, number]): string => snapPoint(point).join(",");

const pointOnSegment = (point: [number, number], segment: DirectedSegment): boolean => {
  const dx = segment.b[0] - segment.a[0];
  const dy = segment.b[1] - segment.a[1];
  const px = point[0] - segment.a[0];
  const py = point[1] - segment.a[1];
  return (
    Math.abs(dx * py - dy * px) <= 1e-6 * Math.max(1, Math.hypot(dx, dy)) &&
    px * dx + py * dy >= -1e-6 &&
    px * dx + py * dy <= dx * dx + dy * dy + 1e-6
  );
};

/** Union two adjacent, non-overlapping detector polygons by cancelling their shared boundary. */
export function mergeShapes(
  source: TakeoffRoomShape,
  target: TakeoffRoomShape,
  resolvedFlag: string,
): TakeoffRoomShape | null {
  const edges = [source.outer, target.outer].flatMap((ring) =>
    ring.map((point, index) => ({
      a: snapPoint(point),
      b: snapPoint(ring[(index + 1) % ring.length]!),
    })),
  );
  const endpoints = edges.flatMap((edge) => [edge.a, edge.b]);
  const pieces: DirectedSegment[] = [];
  // ponytail: O(n^2) endpoint noding is fine for two room rings; use a clipping
  // library if resolutions ever merge large arbitrary polygon sets.
  for (const edge of edges) {
    const dx = edge.b[0] - edge.a[0];
    const dy = edge.b[1] - edge.a[1];
    const cuts = [
      ...new Map(
        endpoints
          .filter((point) => pointOnSegment(point, edge))
          .map((point) => [pointKey(point), point] as const),
      ).values(),
    ].sort((a, b) =>
      Math.abs(dx) >= Math.abs(dy)
        ? (a[0] - edge.a[0]) / dx - (b[0] - edge.a[0]) / dx
        : (a[1] - edge.a[1]) / dy - (b[1] - edge.a[1]) / dy,
    );
    for (let index = 0; index < cuts.length - 1; index++)
      if (pointKey(cuts[index]!) !== pointKey(cuts[index + 1]!))
        pieces.push({ a: cuts[index]!, b: cuts[index + 1]! });
  }

  const grouped = new Map<string, DirectedSegment[]>();
  for (const piece of pieces) {
    const a = pointKey(piece.a);
    const b = pointKey(piece.b);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    grouped.set(key, [...(grouped.get(key) ?? []), piece]);
  }
  const boundary: DirectedSegment[] = [];
  let shared = false;
  for (const group of grouped.values()) {
    if (group.length === 1) boundary.push(group[0]!);
    else if (
      group.length === 2 &&
      pointKey(group[0]!.a) === pointKey(group[1]!.b) &&
      pointKey(group[0]!.b) === pointKey(group[1]!.a)
    )
      shared = true;
    else return null;
  }
  if (!shared) return null;

  const outgoing = new Map<string, number[]>();
  boundary.forEach((edge, index) =>
    outgoing.set(pointKey(edge.a), [...(outgoing.get(pointKey(edge.a)) ?? []), index]),
  );
  const unused = new Set(boundary.map((_, index) => index));
  const loops: [number, number][][] = [];
  while (unused.size > 0) {
    const first = unused.values().next().value as number;
    const start = pointKey(boundary[first]!.a);
    const loop: [number, number][] = [boundary[first]!.a];
    let index = first;
    let closed = false;
    for (let step = 0; step <= boundary.length; step++) {
      if (!unused.delete(index)) return null;
      const edge = boundary[index]!;
      const end = pointKey(edge.b);
      if (end === start) {
        closed = true;
        break;
      }
      loop.push(edge.b);
      const next = (outgoing.get(end) ?? []).filter((candidate) => unused.has(candidate));
      if (next.length !== 1) return null;
      index = next[0]!;
    }
    if (!closed) return null;
    loops.push(loop);
  }
  if (loops.length !== 1 || loops[0]!.length < 3) return null;
  const outer = ringArea(loops[0]!) > 0 ? loops[0]! : [...loops[0]!].reverse();
  const flags = [
    ...new Set([
      ...(target.flags ?? []),
      ...(source.flags ?? []).filter((f) => f !== resolvedFlag),
    ]),
  ].sort();
  return {
    ...target,
    rawSqft: source.rawSqft + target.rawSqft,
    perimeterFt: ringPerimeter(outer),
    outer,
    holes: [...target.holes, ...source.holes],
    ...(flags.length > 0 ? { flags } : {}),
    mergedFrom: source.mergedFrom ?? source.id,
  };
}

const pointInRing = (p: readonly [number, number], ring: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
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
    level.rooms.flatMap((room) =>
      room.rejected
        ? []
        : (room.flags?.filter(isDecisionFlag).map((flag) => ({
            levelName: level.levelName,
            levelIndex,
            roomId: room.id,
            candidateKey: candidateKey(level.levelName, room.id),
            flag,
            rawSqft: room.rawSqft,
            anchor: { label: room.label, sqft: room.rawSqft },
          })) ?? []),
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
