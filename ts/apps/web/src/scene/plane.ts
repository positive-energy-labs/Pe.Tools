/**
 * The plane viewport (a Page key): one pose math for the Space axis pictures and the Rooms and
 * Takeoffs plans (`use-plane-viewport.ts` is its gesture hook). A viewport puts content point
 * (u, v) at canvas px (u * scale + tx, ty -+ v * scale): Space's frames are v up, a plan's
 * content is y down.
 *
 * Space's three axis pictures are right-handed (u x v = w) with w toward the viewer: top (X, Y | Z),
 * north (-X, Z | Y), east (Y, Z | X). The renderer's clip shader (`frameOf`) repeats this mapping.
 */
import type { PlaneViewport } from "@pe/agent-contracts";

import type { Bounds2, Viewport2 } from "#/lib/affine-frame";
import type { Bounds } from "./types";

export type { PlaneViewport };
export type PlaneAxis = "top" | "north" | "east";
export const PLANE_AXES: readonly PlaneAxis[] = ["top", "north", "east"];
export const AXIS_LABEL: Record<PlaneAxis, string> = { top: "Top", north: "North", east: "East" };

/** An axis frame's extent in feet: u, v span the drawing plane, w is the depth toward the viewer. */
export type Rect = { u0: number; u1: number; v0: number; v1: number; w0: number; w1: number };

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

/** The interactive zoom range, px per content unit. */
export const PLANE_ZOOM = [0.02, 24] as const;
export const clampZoom = (scale: number) => Math.min(PLANE_ZOOM[1], Math.max(PLANE_ZOOM[0], scale));

/** `box` centred in `size` at the scale that fits it, less `pad` px a side and a `margin` divisor. */
function fitBox(
  box: Bounds2,
  size: Viewport2,
  { pad, margin, up, clamp }: { pad: number; margin: number; up: boolean; clamp: boolean },
): PlaneViewport {
  const fit =
    Math.min(
      (size.width - 2 * pad) / Math.max(box.maxX - box.minX, 1),
      (size.height - 2 * pad) / Math.max(box.maxY - box.minY, 1),
    ) / margin;
  const scale = clamp ? clampZoom(fit) : fit;
  const cy = ((box.minY + box.maxY) / 2) * scale;
  return {
    kind: "plane",
    scale,
    tx: size.width / 2 - ((box.minX + box.maxX) / 2) * scale,
    ty: size.height / 2 + (up ? cy : -cy),
  };
}

/** A plan's content (y down) filling `size`, `pad` px in from each edge, within the zoom range. */
export const fitView = (box: Bounds2, size: Viewport2, pad = 0): PlaneViewport =>
  fitBox(box, size, { pad, margin: 1, up: false, clamp: true });

/** An axis frame's bounds (v up) filling `size` with a margin; not zoom-clamped, it is in feet. */
export function fitPlane(axis: PlaneAxis, bounds: Bounds, size: Viewport2): PlaneViewport {
  const r = frameRect(axis, bounds);
  return fitBox({ minX: r.u0, maxX: r.u1, minY: r.v0, maxY: r.v1 }, size, {
    pad: 0,
    margin: 1.12,
    up: true,
    clamp: false,
  });
}

/** The frame point at the canvas centre. */
export const planeCentre = (v: PlaneViewport, size: Viewport2): [number, number] => [
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
