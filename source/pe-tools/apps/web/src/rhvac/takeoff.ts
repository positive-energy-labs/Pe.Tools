/**
 * Client-side mirror of RhvacCandidateBuilder.ParseTsv (source/Pe.Revit.Takeoff/
 * Rhvac/RhvacCandidateBuilder.cs): META/ROOM/POLY lines, tab-separated, POLY
 * loops as "x;y|x;y|…" in feet, model coordinates (Y up — flipped at render).
 * Display-lenient where the C# parser throws: we surface a message instead of
 * refusing the whole plan pane.
 */
import type { TakeoffLevel, TakeoffRoomShape } from "#/rhvac/types";

export function parseTakeoffTsv(tsvText: string, options?: { simplify?: boolean }): TakeoffLevel {
  let levelName: string | null = null;
  let elevation: number | null = null;
  const rooms: TakeoffRoomShape[] = [];
  const byId = new Map<string, TakeoffRoomShape>();

  for (const rawLine of tsvText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) continue;
    const parts = line.split("\t");
    switch (parts[0]) {
      case "META":
        if (parts[1] === "level") levelName = parts[2] ?? null;
        else if (parts[1] === "elev") elevation = Number(parts[2]);
        // rooms / totalSqft are display metadata; ignored.
        break;
      case "ROOM": {
        if (parts.length < 7) throw new Error(`malformed ROOM line: ${line.slice(0, 80)}`);
        const room: TakeoffRoomShape = {
          id: parts[1]!,
          rawSqft: Number(parts[2]),
          perimeterFt: Number(parts[3]),
          meanCeilingFt: Number(parts[6]),
          outer: [],
          holes: [],
        };
        rooms.push(room);
        byId.set(room.id, room);
        break;
      }
      case "POLY": {
        if (parts.length < 4) throw new Error(`malformed POLY line: ${line.slice(0, 80)}`);
        const target = byId.get(parts[1]!);
        if (!target) throw new Error(`POLY references unknown room '${parts[1]}'`);
        const loop = parseLoop(parts[3]!);
        if (parts[2] === "outer") target.outer.push(...loop);
        else if (parts[2] === "hole") target.holes.push(loop);
        else throw new Error(`unknown loop kind '${parts[2]}'`);
        break;
      }
      default:
        throw new Error(`unrecognized TSV line: ${line.slice(0, 80)}`);
    }
  }

  if (levelName === null || elevation === null || Number.isNaN(elevation))
    throw new Error("takeoff TSV has no META level/elev header");
  const kept = rooms.filter((r) => r.outer.length >= 3);
  if (options?.simplify !== false) simplifyLevelLoops(kept);
  return { levelName, elevation, rooms: kept };
}

function parseLoop(text: string): [number, number][] {
  return text.split("|").map((pair) => {
    const [x, y] = pair.split(";");
    const point: [number, number] = [Number(x), Number(y)];
    if (Number.isNaN(point[0]) || Number.isNaN(point[1]))
      throw new Error(`malformed POLY point '${pair}'`);
    return point;
  });
}

// ── raster simplification ────────────────────────────────────────────────────
// The detector emits marching-squares staircase outlines on its raster grid, so
// diagonal walls arrive as hundreds of one-cell steps (and read up to sqrt(2)
// too long). Collapse collinear runs, then Douglas-Peucker with tolerance = one
// grid cell, derived from the data. Mirror of RhvacCandidateBuilder.cs — keep
// the algorithm and tolerance semantics aligned.

/** A level whose finest step exceeds this is not a raster staircase; leave it alone. */
const MAX_RASTER_PITCH_FT = 1.0;

/** Edges up to this many grid cells are staircase steps, not real wall runs. */
const STAIR_EDGE_CELLS = 2.5;

/** Smallest positive axis-aligned edge component across the loops = detector grid pitch. */
export function deriveGridPitch(loops: [number, number][][]): number | null {
  let pitch = Infinity;
  for (const loop of loops)
    for (let i = 0; i < loop.length; i++) {
      const [x0, y0] = loop[i]!;
      const [x1, y1] = loop[(i + 1) % loop.length]!;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      if (dx > 1e-6 && dx < pitch) pitch = dx;
      if (dy > 1e-6 && dy < pitch) pitch = dy;
    }
  return Number.isFinite(pitch) ? pitch : null;
}

function simplifyLevelLoops(rooms: TakeoffRoomShape[]): void {
  const pitch = deriveGridPitch(rooms.flatMap((room) => [room.outer, ...room.holes]));
  if (pitch === null || pitch > MAX_RASTER_PITCH_FT) return;
  for (const room of rooms) {
    const [outer, holes] = simplifyShape(room.outer, room.holes, pitch);
    room.outer = outer;
    room.holes = holes;
  }
}

/** Perpendicular distance from p to the (a, b) line; plain distance when a≈b. */
function deviation(p: [number, number], a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const len = Math.hypot(abx, aby);
  return len < 1e-9 ? Math.hypot(apx, apy) : Math.abs(abx * apy - aby * apx) / len;
}

/** Douglas-Peucker over an open chain; endpoints are always kept. */
function simplifyChain(pts: [number, number][], tolerance: number): [number, number][] {
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const spans: [number, number][] = [[0, pts.length - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop()!;
    let maxDeviation = tolerance;
    let split = -1;
    for (let i = first + 1; i < last; i++) {
      const d = deviation(pts[i]!, pts[first]!, pts[last]!);
      if (d > maxDeviation) {
        maxDeviation = d;
        split = i;
      }
    }
    if (split >= 0) {
      keep[split] = true;
      spans.push([first, split], [split, last]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** Drop consecutive duplicates and exactly-collinear vertices — area-exact. */
function collapseCollinear(ring: [number, number][]): [number, number][] {
  const deduped = ring.filter((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    return Math.abs(p[0] - prev[0]) > 1e-9 || Math.abs(p[1] - prev[1]) > 1e-9;
  });
  return deduped.filter((p, i) => {
    const prev = deduped[(i + deduped.length - 1) % deduped.length]!;
    const next = deduped[(i + 1) % deduped.length]!;
    return deviation(p, prev, next) > 1e-9;
  });
}

/**
 * One simplification attempt. Staircase edges (a few cells or shorter) are
 * replaced by their midpoints — for a uniform marching-squares staircase those
 * lie exactly on the true wall line, so straightening is area-unbiased
 * (anchoring Douglas-Peucker on staircase corners instead shaves ~pitch/2 x
 * length off every diagonal). Long edges keep their endpoints, so real corners
 * stay exact. Then collinear runs collapse and Douglas-Peucker runs on the two
 * chains between vertex 0 and the vertex farthest from it (the split makes DP
 * well-defined on a ring).
 */
function simplifyOnce(
  ring: [number, number][],
  pitch: number,
  tolerance: number,
): [number, number][] {
  const stairMax = STAIR_EDGE_CELLS * pitch;
  const mid: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= stairMax)
      mid.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    else mid.push(a, b);
  }
  const pts = collapseCollinear(mid);
  if (pts.length < 4) return pts;

  let far = 0;
  let farDist = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - pts[0]![0], pts[i]![1] - pts[0]![1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const chainA = simplifyChain(pts.slice(0, far + 1), tolerance);
  const chainB = simplifyChain([...pts.slice(far), pts[0]!], tolerance);
  const result = [...chainA.slice(0, -1), ...chainB.slice(0, -1)];
  return result.length >= 3 ? result : pts;
}

/**
 * Simplify a room shape, adaptively: try Douglas-Peucker at one grid cell,
 * halving the tolerance while the shape's net area (outer minus holes — the
 * exported truth RawSqft cross-checks downstream) drifts past the gate.
 * Sawtooth slivers that no tolerance can straighten honestly fall back to an
 * area-exact collinear collapse.
 */
export function simplifyShape(
  outer: [number, number][],
  holes: [number, number][][],
  pitch: number,
): [[number, number][], [number, number][][]] {
  const netArea = (o: [number, number][], hs: [number, number][][]) =>
    Math.abs(ringArea(o)) - hs.reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0);
  const rawArea = netArea(outer, holes);
  const gate = Math.max(0.5, 0.01 * Math.abs(rawArea));
  for (const tolerance of [pitch, pitch / 2, pitch / 4]) {
    const simpleOuter = simplifyOnce(outer, pitch, tolerance);
    if (simpleOuter.length < 3) continue;
    const simpleHoles = holes
      .map((hole) => simplifyOnce(hole, pitch, tolerance))
      .filter((hole) => hole.length >= 3);
    if (Math.abs(netArea(simpleOuter, simpleHoles) - rawArea) <= gate)
      return [simpleOuter, simpleHoles];
  }
  const exactOuter = collapseCollinear(outer);
  const exactHoles = holes.map(collapseCollinear).filter((hole) => hole.length >= 3);
  return exactOuter.length >= 3 ? [exactOuter, exactHoles] : [outer, holes];
}

// ── render geometry helpers ──────────────────────────────────────────────────

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function levelBounds(level: TakeoffLevel): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of level.rooms)
    for (const [x, y] of room.outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Model Y is up, SVG Y is down — mirror inside the level's own bounds. */
const flipY = (y: number, bounds: Bounds) => bounds.minY + bounds.maxY - y;

export function shapePathD(shape: TakeoffRoomShape, bounds: Bounds): string {
  const loopD = (loop: [number, number][]) =>
    loop
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${flipY(y, bounds).toFixed(2)}`)
      .join("") + "Z";
  return [loopD(shape.outer), ...shape.holes.map(loopD)].join("");
}

/** Area-weighted centroid of the outer loop (shoelace), in flipped (SVG) coordinates. */
export function shapeCentroid(shape: TakeoffRoomShape, bounds: Bounds): [number, number] {
  const pts = shape.outer;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const [x, y] = pts[0]!;
    return [x, flipY(y, bounds)];
  }
  area *= 0.5;
  return [cx / (6 * area), flipY(cy / (6 * area), bounds)];
}
