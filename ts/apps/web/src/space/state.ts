/**
 * The cut math: one canonical cut per axis (`spaceCutsSchema`), drawn in that axis's frame
 * (`scene/plane.ts`) and extruded through the scene; the retained volume is their intersection.
 * CPU picking (`retained`) and the shader (`packPolygons`) read the same polygons.
 */
import type { spaceCutsSchema } from "@pe/agent-contracts/space-view";
import type { z } from "zod";

import { CLIP_POINTS } from "#/scene/renderer";
import {
  AXIS_LABEL,
  PLANE_AXES as AXES,
  frameRect,
  toFrame,
  type PlaneAxis as Axis,
  type Rect,
} from "#/scene/plane";
import type { Bounds } from "#/scene/types";

export { AXES, AXIS_LABEL, type Axis };

export type Point = [number, number];
export type Cuts = z.output<typeof spaceCutsSchema>;
export type Cut = Cuts[Axis];
type Shape = Pick<Cut, "polyline" | "closed" | "offset">;
export const emptyCut: Cut = { polyline: [], closed: false, offset: 0, keepInside: true };

/** Shift a cut parallel by `offset` along the left normal of its drawing direction, mitring each bend. */
export function offsetCut({ polyline: points, closed, offset }: Shape): Point[] {
  if (offset === 0 || points.length < 2) return points;
  const n = points.length;
  const normal = (a: Point, b: Point): Point => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.000001) throw Error("Cut points must be distinct");
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const shifted = points.map((p, i): Point => {
    const prev = closed || i > 0 ? points[(i - 1 + n) % n]! : null;
    const next = closed || i < n - 1 ? points[(i + 1) % n]! : null;
    const a = prev ? normal(prev, p) : null,
      b = next ? normal(p, next) : null;
    const [nx, ny] = a && b ? [a[0] + b[0], a[1] + b[1]] : (a ?? b)!;
    const scale = a && b ? 1 + a[0] * b[0] + a[1] * b[1] : 1;
    if (scale < 0.02) throw Error("Cut bend is too sharp to offset. Open the bend first.");
    return [p[0] + (offset * nx) / scale, p[1] + (offset * ny) / scale];
  });
  // An offset past a segment's length turns that segment around: the shape inverts without crossing.
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i]!,
      b = points[(i + 1) % n]!,
      c = shifted[i]!,
      d = shifted[(i + 1) % n]!;
    if ((b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]) <= 0)
      throw Error("Offset is longer than a cut segment allows. Reduce the offset.");
  }
  return shifted;
}

/** The plan polygon whose even-odd interior is retained (CPU picking and the GPU shader both read it).
 * A closed cut is its own polygon. An open cut extends its end tangents to an enclosing rectangle,
 * then follows its perimeter, so the closure lies outside all scene geometry, never across a snaking cut. */
export function cutPolygon(cut: Shape, rect: Rect): Point[] {
  if (cut.polyline.length < 2) return [];
  const points = offsetCut(cut);
  const polygon = cut.closed ? points : openPolygon(points, rect);
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  // A crossing path has no single retained side, including when an end extension crosses a bend.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      const c = polygon[j]!,
        d = polygon[(j + 1) % polygon.length]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        throw Error(
          cut.closed
            ? "Cut polygon crosses itself. Drag a vertex to untangle it."
            : "Cut crosses itself or its end extensions. Move a bend or change the end direction.",
        );
    }
  }
  return polygon;
}

function openPolygon(points: Point[], rect: Rect): Point[] {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const margin = Math.max(rect.u1 - rect.u0, rect.v1 - rect.v0, 1);
  const x0 = Math.min(rect.u0, ...xs) - margin,
    x1 = Math.max(rect.u1, ...xs) + margin;
  const y0 = Math.min(rect.v0, ...ys) - margin,
    y1 = Math.max(rect.v1, ...ys) + margin;
  const w = x1 - x0,
    h = y1 - y0,
    perimeter = 2 * (w + h);
  const extend = (a: Point, b: Point): { point: Point; at: number } => {
    const dx = a[0] - b[0],
      dy = a[1] - b[1];
    if (Math.hypot(dx, dy) < 0.000001) throw Error("Cut points must be distinct");
    const tx = dx > 0 ? (x1 - a[0]) / dx : dx < 0 ? (x0 - a[0]) / dx : Infinity;
    const ty = dy > 0 ? (y1 - a[1]) / dy : dy < 0 ? (y0 - a[1]) / dy : Infinity;
    const t = Math.min(tx, ty),
      p: Point = [a[0] + t * dx, a[1] + t * dy];
    const at =
      tx < ty
        ? dx > 0
          ? w + p[1] - y0
          : 2 * w + h + y1 - p[1]
        : dy > 0
          ? w + h + x1 - p[0]
          : p[0] - x0;
    return { point: p, at };
  };
  const start = extend(points[0]!, points[1]!);
  const end = extend(points.at(-1)!, points.at(-2)!);
  const corners: { point: Point; at: number }[] = [
    { point: [x1, y0], at: w },
    { point: [x1, y1], at: w + h },
    { point: [x0, y1], at: 2 * w + h },
    { point: [x0, y0], at: perimeter },
  ];
  const finish = start.at <= end.at ? start.at + perimeter : start.at;
  const boundary = [...corners, ...corners.map((c) => ({ ...c, at: c.at + perimeter }))]
    .filter((c) => c.at > end.at && c.at < finish)
    .map((c) => c.point);
  return [start.point, ...points, end.point, ...boundary];
}

export function insidePolygon(x: number, y: number, points: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (a[1]! > y !== b[1]! > y && x < ((b[0]! - a[0]!) * (y - a[1]!)) / (b[1]! - a[1]!) + a[0]!)
      inside = !inside;
  }
  return inside;
}

export type Polygons = Record<Axis, Point[]>;
/** Every axis polygon, validated together; throws the first failing axis's reason. */
export function cutPolygons(cuts: Cuts, bounds: Bounds): Polygons {
  const polygons = {} as Polygons;
  for (const axis of AXES) {
    try {
      polygons[axis] = cutPolygon(cuts[axis], frameRect(axis, bounds));
    } catch (e) {
      throw Error(`${AXIS_LABEL[axis]} cut: ${(e as Error).message}`);
    }
  }
  return polygons;
}

/** The retained volume is the intersection of the three extruded cuts. An empty cut keeps everything. */
export function retained(p: ArrayLike<number>, cuts: Cuts, polygons: Polygons): boolean {
  return AXES.every((axis) => {
    const polygon = polygons[axis];
    if (polygon.length < 3) return true;
    const [u, v] = toFrame(axis, p);
    return insidePolygon(u, v, polygon) === cuts[axis].keepInside;
  });
}

/** The exact numbers the shader reads: per axis, polygon points relative to `origin`'s frame
 * coordinates, packed two per vec4. Picking reads the same polygons, so shapes cannot disagree. */
export function packPolygons(polygons: Polygons, cuts: Cuts, origin: ArrayLike<number>) {
  const data = new Float32Array(AXES.length * CLIP_POINTS * 2);
  const counts = [0, 0, 0],
    keepInside = [true, true, true];
  AXES.forEach((axis, a) => {
    const polygon = polygons[axis];
    if (polygon.length > CLIP_POINTS) throw Error("Cut polygon exceeds the shader budget");
    const [ou, ov] = toFrame(axis, origin);
    counts[a] = polygon.length;
    keepInside[a] = cuts[axis].keepInside;
    polygon.forEach((p, i) => {
      data[(a * CLIP_POINTS + i) * 2] = p[0] - ou;
      data[(a * CLIP_POINTS + i) * 2 + 1] = p[1] - ov;
    });
  });
  return { data, counts, keepInside };
}

/* ── Node edits. Each returns the edited cut, `null` when the last edge is gone (the cut clears),
   or a sentence explaining the refusal. An open cut keeps two nodes, a closed cut three. ── */

export const edgeCount = (cut: Shape) =>
  cut.polyline.length < 2 ? 0 : cut.closed ? cut.polyline.length : cut.polyline.length - 1;
export function insertNode(cut: Cut, edge: number, point: Point): Cut | string {
  if (cut.polyline.length >= 56) return "A cut holds 56 nodes at most.";
  const polyline = [...cut.polyline];
  polyline.splice(edge + 1, 0, point);
  return { ...cut, polyline };
}
export function deleteNode(cut: Cut, index: number): Cut | null | string {
  if (cut.closed && cut.polyline.length <= 3)
    return "A closed cut keeps three nodes. Reopen it to remove another.";
  if (cut.polyline.length <= 2) return null;
  return { ...cut, polyline: cut.polyline.filter((_, i) => i !== index) };
}
export function moveNode(cut: Cut, index: number, point: Point): Cut {
  return { ...cut, polyline: cut.polyline.map((p, i) => (i === index ? point : p)) };
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross2 = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
/** Where line p + t·d meets line q + s·e, or null when they are (near) parallel. */
function meet(p: Point, d: Point, q: Point, e: Point): Point | null {
  const den = cross2(d, e);
  if (Math.abs(den) < 1e-9 * Math.hypot(...d) * Math.hypot(...e)) return null;
  const t = cross2(sub(q, p), e) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

/**
 * Drag edge `edge` by `delta`, folding like paper. The edge moves along its own normal, and each end
 * slides along its neighbouring edge's supporting line, so the neighbours keep their directions.
 * An end with no neighbour (an open cut's end) or a neighbour parallel to the edge moves with the
 * normal shift instead. An edge with no neighbours at all (a two-node line) translates freely.
 * Pushed past the point where both neighbouring lines meet, the edge collapses: its two nodes
 * become one node at that intersection (a chamfer removed becomes the corner it cut).
 */
export function dragEdge(cut: Cut, edge: number, delta: Point): { cut: Cut; collapsed: boolean } {
  const P = cut.polyline,
    n = P.length,
    i = edge,
    j = (edge + 1) % n;
  const a = P[i]!,
    b = P[j]!;
  const prev = cut.closed || i > 0 ? P[(i - 1 + n) % n]! : null;
  const next = cut.closed || j < n - 1 ? P[(j + 1) % n]! : null;
  if (!prev && !next) {
    const moved: Point[] = [
      [a[0] + delta[0], a[1] + delta[1]],
      [b[0] + delta[0], b[1] + delta[1]],
    ];
    return { cut: { ...cut, polyline: moved }, collapsed: false };
  }
  const along = sub(b, a),
    length = Math.hypot(...along);
  const normal: Point = [-along[1] / length, along[0] / length];
  const s = dot(delta, normal);
  const shift: Point = [s * normal[0], s * normal[1]];
  const slide = (end: Point, neighbour: Point | null): Point =>
    (neighbour &&
      meet([end[0] + shift[0], end[1] + shift[1]], along, end, sub(end, neighbour))) ?? [
      end[0] + shift[0],
      end[1] + shift[1],
    ];
  const folded = P.map((p, k): Point => (k === i ? slide(a, prev) : k === j ? slide(b, next) : p));
  // Collapse needs a finite corner on the side being pushed toward, already reached, and a shape
  // that still meets the minimum node count; otherwise the fold stands as it is.
  const corner = prev && next ? meet(a, sub(a, prev), b, sub(b, next)) : null;
  const reach = corner ? dot(sub(corner, a), normal) : 0;
  if (corner && Math.abs(reach) > 1e-6 && s / reach >= 1 && n - 1 >= (cut.closed ? 3 : 2)) {
    const polyline = P.flatMap((p, k): Point[] => (k === i ? [corner] : k === j ? [] : [p]));
    return { cut: { ...cut, polyline }, collapsed: true };
  }
  return { cut: { ...cut, polyline: folded }, collapsed: false };
}

/** The nearest point on segment a-b to p, used to place a node where the edge was clicked. */
export function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const d = sub(b, a),
    l = dot(d, d);
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l));
  return [a[0] + t * d[0], a[1] + t * d[1]];
}
/** Seeds for an empty axis: a section line across the middle (keeps the +v half), or a box. */
export function seedCut(rect: Rect, shape: "line" | "box"): Cut {
  const du = (rect.u1 - rect.u0) * 0.15,
    dv = (rect.v1 - rect.v0) * 0.15,
    mid = (rect.v0 + rect.v1) / 2;
  return shape === "line"
    ? {
        ...emptyCut,
        polyline: [
          [rect.u0 + du, mid],
          [rect.u1 - du, mid],
        ],
      }
    : {
        ...emptyCut,
        closed: true,
        polyline: [
          [rect.u0 + du, rect.v0 + dv],
          [rect.u1 - du, rect.v0 + dv],
          [rect.u1 - du, rect.v1 - dv],
          [rect.u0 + du, rect.v1 - dv],
        ],
      };
}
