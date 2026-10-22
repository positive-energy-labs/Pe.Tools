/**
 * The three axis pictures a `Scene3D` draws orthographically, and the plane viewport (a Page key)
 * over each. Each axis frame is right-handed (u x v = w) with w toward the viewer: top (X, Y | Z),
 * north (-X, Z | Y), east (Y, Z | X). The renderer's clip shader (`frameOf`) repeats this mapping.
 *
 * A plane viewport puts frame point (u, v) at canvas px (u * scale + tx, ty - v * scale): v up.
 */
import type { PlaneViewport } from "@pe/agent-contracts";

import type { Bounds } from "./types";

export type { PlaneViewport };
export type PlaneAxis = "top" | "north" | "east";
export const PLANE_AXES: readonly PlaneAxis[] = ["top", "north", "east"];
export const AXIS_LABEL: Record<PlaneAxis, string> = { top: "Top", north: "North", east: "East" };

/** An axis frame's extent in feet: u, v span the drawing plane, w is the depth toward the viewer. */
export type Rect = { u0: number; u1: number; v0: number; v1: number; w0: number; w1: number };
type Size = { width: number; height: number };

/** World (x, y, z) to frame (u, v, w). Linear, so it maps directions too. */
export function toFrame(axis: PlaneAxis, p: ArrayLike<number>): [number, number, number] {
  const x = p[0]!,
    y = p[1]!,
    z = p[2]!;
  return axis === "top" ? [x, y, z] : axis === "north" ? [-x, z, y] : [y, z, x];
}
export function fromFrame(
  axis: PlaneAxis,
  u: number,
  v: number,
  w: number,
): [number, number, number] {
  return axis === "top" ? [u, v, w] : axis === "north" ? [-u, w, v] : [w, u, v];
}
export function frameRect(axis: PlaneAxis, b: Bounds): Rect {
  const a = toFrame(axis, [b.minX, b.minY, b.minZ]),
    c = toFrame(axis, [b.maxX, b.maxY, b.maxZ]);
  return {
    u0: Math.min(a[0], c[0]),
    u1: Math.max(a[0], c[0]),
    v0: Math.min(a[1], c[1]),
    v1: Math.max(a[1], c[1]),
    w0: Math.min(a[2], c[2]),
    w1: Math.max(a[2], c[2]),
  };
}

/** The frame's bounds filling `size` with a margin. */
export function fitPlane(axis: PlaneAxis, bounds: Bounds, size: Size): PlaneViewport {
  const r = frameRect(axis, bounds);
  const scale =
    Math.min(size.width / Math.max(r.u1 - r.u0, 1), size.height / Math.max(r.v1 - r.v0, 1)) / 1.12;
  return {
    kind: "plane",
    scale,
    tx: size.width / 2 - ((r.u0 + r.u1) / 2) * scale,
    ty: size.height / 2 + ((r.v0 + r.v1) / 2) * scale,
  };
}

/** The frame point at the canvas centre. */
export const planeCentre = (v: PlaneViewport, size: Size): [number, number] => [
  (size.width / 2 - v.tx) / v.scale,
  (v.ty - size.height / 2) / v.scale,
];

/** Zoom by `k` about canvas px (x, y), which stays over the same frame point. */
export const zoomPlane = (v: PlaneViewport, k: number, x: number, y: number): PlaneViewport => ({
  kind: "plane",
  scale: v.scale * k,
  tx: x - (x - v.tx) * k,
  ty: y - (y - v.ty) * k,
});

/** Same pose within what a page key keeps (three decimals). */
export const samePlane = (a: PlaneViewport, b: PlaneViewport) =>
  Math.abs(a.scale / b.scale - 1) < 1e-3 &&
  Math.abs(a.tx - b.tx) < 0.01 &&
  Math.abs(a.ty - b.ty) < 0.01;
