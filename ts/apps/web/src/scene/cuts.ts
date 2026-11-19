import type { SceneSection } from "@pe/agent-contracts";
import {
  spaceCutsSchema,
  validateCutPolyline as validatePolyline,
  offsetSpaceCut,
} from "@pe/agent-contracts/space-view";
import type { z } from "zod";
import type { Bounds, Layer3D } from "./types";
import * as THREE from "three";
import { datumMaterial, markMaterial } from "./grounds";
import { frameRect, fromFrame } from "./plane";

export type Cuts = z.output<typeof spaceCutsSchema>;
export type Cut = Cuts["top"];
export type CutAxis = keyof Cuts;
export type Point = [number, number];
export const CUT_AXES = ["top", "north", "east"] as const;
export const emptyCuts = (): Cuts =>
  spaceCutsSchema.parse(
    Object.fromEntries(
      CUT_AXES.map((a) => [
        a,
        {
          polyline: [],
          closed: false,
          offset: 0,
          keepInside: true,
        },
      ]),
    ),
  );
export const axisPoint = (axis: CutAxis, p: readonly number[]): Point =>
  axis === "top" ? [p[0], p[1]] : axis === "north" ? [-p[0], p[2]] : [p[1], p[2]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const add = (a: Point, d: Point, t: number): Point => [a[0] + d[0] * t, a[1] + d[1] * t];
const direction = (a: Point, b: Point): Point => {
  const d = sub(b, a),
    length = Math.hypot(...d);
  if (length < 0.001) throw new Error("Cut points must be distinct");
  return [d[0] / length, d[1] / length];
};

/** Offset is authored in feet and applied once, before closure and packing. */
export const offsetCut = offsetSpaceCut;

export function axisBounds(bounds: Bounds, axis: CutAxis): [Point, Point] {
  return axis === "top"
    ? [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.maxY],
      ]
    : axis === "north"
      ? [
          [-bounds.maxX, bounds.minZ],
          [-bounds.minX, bounds.maxZ],
        ]
      : [
          [bounds.minY, bounds.minZ],
          [bounds.maxY, bounds.maxZ],
        ];
}

/** Open ends reach a common outer rectangle, then close counterclockwise, keeping the left side. */
export function cutPolygon(cut: Cut, extent: [Point, Point]): Point[] {
  if (!cut.polyline.length) return [];
  validatePolyline(cut.polyline, cut.closed);
  const p = offsetCut(cut);
  if (!cut.closed) {
    const xs = [...p.map((p) => p[0]), extent[0][0], extent[1][0]],
      ys = [...p.map((p) => p[1]), extent[0][1], extent[1][1]];
    const margin =
      Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) +
      Math.abs(cut.offset);
    const lo: Point = [Math.min(...xs) - margin, Math.min(...ys) - margin];
    const hi: Point = [Math.max(...xs) + margin, Math.max(...ys) + margin];
    const corners: Point[] = [
      [lo[0], lo[1]],
      [hi[0], lo[1]],
      [hi[0], hi[1]],
      [lo[0], hi[1]],
    ];
    const ray = (at: Point, d: Point) => {
      let t = Infinity,
        side = 0;
      for (const [k, value, edge] of [
        [0, lo[0], 3],
        [0, hi[0], 1],
        [1, lo[1], 0],
        [1, hi[1], 2],
      ]) {
        const n = (value - at[k]) / d[k];
        if (n > 0 && n < t) {
          t = n;
          side = edge;
        }
      }
      return { at: add(at, d, t), side };
    };
    const start = ray(p[0], direction(p[1], p[0])),
      end = ray(p[p.length - 1], direction(p[p.length - 2], p[p.length - 1]));
    const closure: Point[] = [];
    // Same-side ends may still need a full boundary traversal.
    const edgeDirection = sub(corners[(end.side + 1) % 4], corners[end.side]);
    const forward = sub(start.at, end.at);
    const sameAhead =
      start.side === end.side && forward[0] * edgeDirection[0] + forward[1] * edgeDirection[1] >= 0;
    if (!sameAhead)
      for (let edge = end.side; ; edge = (edge + 1) % 4) {
        closure.push(corners[(edge + 1) % 4]);
        if ((edge + 1) % 4 === start.side) break;
      }
    p.splice(0, 0, start.at);
    p.push(end.at, ...closure);
    // A ray through a rectangle corner names the same point as the boundary walk.
    for (let i = p.length - 1; i > 0; i--)
      if (Math.hypot(...sub(p[i], p[i - 1])) < 1e-8) p.splice(i, 1);
    if (Math.hypot(...sub(p[0], p[p.length - 1])) < 1e-8) p.pop();
  }
  if (p.length > 64) throw new Error("Cut exceeds the 64 packed point limit");
  validatePolyline(p, true);
  return p;
}

export function polygonContains(polygon: Point[], p: Point) {
  if (!polygon.length) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i],
      ab = sub(b, a),
      ap = sub(p, a);
    if (
      Math.abs(cross(ab, ap)) < 1e-7 &&
      ap[0] * ab[0] + ap[1] * ab[1] >= 0 &&
      ap[0] * ab[0] + ap[1] * ab[1] <= ab[0] ** 2 + ab[1] ** 2
    )
      return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function packCuts(cuts: Cuts, bounds: Bounds, origin: readonly number[]) {
  const data = new Float32Array(384);
  const polygons = CUT_AXES.map((axis) => cutPolygon(cuts[axis], axisBounds(bounds, axis)));
  polygons.forEach((p, a) => {
    const o = axisPoint(CUT_AXES[a], origin);
    p.forEach((p, i) => data.set([p[0] - o[0], p[1] - o[1]], a * 128 + i * 2));
  });
  return {
    data,
    counts: polygons.map((p) => p.length),
    keepInside: CUT_AXES.map((a) => cuts[a].keepInside),
  };
}

/** Conversions are explicit authoring, never saved-view migration. */
export function sectionCuts(section: SceneSection | null, bounds: Bounds): Cuts {
  if (section?.kind === "cuts") return structuredClone(section.cuts);
  const cuts = emptyCuts();
  if (section?.kind === "box")
    for (const axis of CUT_AXES) {
      const [a, b] = axisBounds(section.bounds, axis);
      cuts[axis] = {
        polyline: [a, [b[0], a[1]], b, [a[0], b[1]]],
        closed: true,
        offset: 0,
        keepInside: true,
      };
    }
  if (section?.kind === "plane") {
    const axis = section.axis === "z" ? "north" : "top",
      [lo, hi] = axisBounds(bounds, axis);
    const offset = section.offset;
    const horizontal = section.axis !== "x";
    cuts[axis] = {
      polyline: horizontal
        ? [
            [lo[0], offset],
            [hi[0], offset],
          ]
        : [
            [offset, lo[1]],
            [offset, hi[1]],
          ],
      closed: false,
      offset: 0,
      keepInside: horizontal ? section.keep === "above" : section.keep === "below",
    };
  }
  return cuts;
}

/** A release within ten screen pixels merges neighbours; a collapsed bevel drops both ends. */
export function mergeCut(cut: Cut, pixelsPerFoot: number): Cut {
  const p = cut.polyline.map((p): Point => [...p]);
  for (let i = p.length - 1; i > 0; i--)
    if (Math.hypot(...sub(p[i], p[i - 1])) * pixelsPerFoot <= 10) p.splice(i, 1);
  if (cut.closed && p.length > 1 && Math.hypot(...sub(p[0], p[p.length - 1])) * pixelsPerFoot <= 10)
    p.pop();
  return { ...cut, polyline: p };
}

/** Move an edge along its normal, retaining the neighbouring lines. A bevel folds to their corner. */
export function moveCutEdge(cut: Cut, edge: number, delta: Point): Cut {
  const p = cut.polyline.map((p): Point => [...p]),
    n = p.length;
  const end = (edge + 1) % n,
    a = p[edge],
    b = p[end],
    d = direction(a, b);
  const normal: Point = [-d[1], d[0]],
    distance = delta[0] * normal[0] + delta[1] * normal[1];
  const movedA = add(a, normal, distance),
    movedB = add(b, normal, distance);
  const previous = cut.closed || edge > 0 ? p[(edge + n - 1) % n] : null;
  const next = cut.closed || end < n - 1 ? p[(end + 1) % n] : null;
  const intersect = (at: Point, vector: Point, other: Point, line: Point): Point | null => {
    const den = cross(vector, line);
    return Math.abs(den) < 1e-8 ? null : add(at, vector, cross(sub(other, at), line) / den);
  };
  const before = previous && sub(a, previous),
    after = next && sub(next, b);
  const start = before ? (intersect(movedA, d, a, before) ?? movedA) : movedA;
  const finish = after ? (intersect(movedB, d, b, after) ?? movedB) : movedB;
  if (before && after && sub(finish, start)[0] * d[0] + sub(finish, start)[1] * d[1] <= 0) {
    const corner = intersect(a, before, b, after);
    if (corner) {
      p[edge] = corner;
      p.splice(end, 1);
      return { ...cut, polyline: p };
    }
  }
  p[edge] = start;
  p[end] = finish;
  return { ...cut, polyline: p };
}

/** An open curtain is drawing furniture, never a cap or captured geometry. */
export function cutCurtain(cuts: Cuts, bounds: Bounds): Layer3D {
  const positions: number[] = [],
    lines: number[] = [];
  for (const axis of CUT_AXES) {
    const p = cutPolygon(cuts[axis], axisBounds(bounds, axis));
    const { w0, w1 } = frameRect(axis, bounds);
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length];
      const corners = [
        fromFrame(axis, ...a, w0),
        fromFrame(axis, ...b, w0),
        fromFrame(axis, ...b, w1),
        fromFrame(axis, ...a, w1),
      ];
      // Both windings keep a curtain visible from either side without asserting a closed solid.
      for (const index of [0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]) positions.push(...corners[index]);
      lines.push(...corners[0], ...corners[1], ...corners[3], ...corners[2]);
    });
  }
  const materials = new WeakMap<THREE.Group, THREE.Material[]>();
  return {
    key: "section-editor-curtain",
    build(group) {
      const line = datumMaterial(),
        fill = markMaterial(line.color);
      fill.opacity = line.opacity;
      const geometry = (data: number[]) =>
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(data, 3),
        );
      group.add(
        new THREE.LineSegments(geometry(lines), line),
        new THREE.Mesh(geometry(positions), fill),
      );
      materials.set(group, [line, fill]);
    },
    frame(group, at) {
      if (at.ink)
        for (const material of materials.get(group) ?? [])
          if (
            material instanceof THREE.LineBasicMaterial ||
            material instanceof THREE.MeshBasicMaterial
          )
            material.color.copy(at.ink);
      return false;
    },
  };
}
