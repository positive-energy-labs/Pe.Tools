/**
 * A connector's end face as a closed outline, and what of one face overhangs another. The drawing
 * of a join in 3D and the grader read the same section (`sectionOf`, `proximity.ts`), so what the
 * picture paints as overhung is what the proximity rule measured. Pure; points are model feet.
 */
import { sectionOf, type Sized } from "./proximity.ts";

export interface Outline {
  center: number[];
  /** The face's outward axis, a unit vector. */
  normal: number[];
  /** The closed loop's corners in order; a round section is a polygon of `ROUND_SIDES`. */
  points: number[][];
  /** The section's frame: unit axes and half sizes along them (a round one's `w` and `h` are its radius). */
  x: number[];
  y: number[];
  w: number;
  h: number;
}
export type Edge = [number[], number[]];

const ROUND_SIDES = 24;
/** Along an edge, clipped lengths under this (ft, about 0.001 in) are coincident, not overhung. */
const EPS = 1e-4;
const sub = (p: number[], q: number[]) => p.map((v, k) => v - q[k]!);
const add = (p: number[], q: number[], by = 1) => p.map((v, k) => v + q[k]! * by);
const dot = (p: number[], q: number[]) => p.reduce((s, v, k) => s + v * q[k]!, 0);
const cross = (a: number[], b: number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const unit = (p: number[]) => {
  const n = Math.hypot(...p);
  return n < 1e-9 ? null : p.map((v) => v / n);
};

/**
 * The face of a connector at `center` facing `axis`, rolled by `roll` (its `widthAxis`), or null
 * when it states no size.
 * ponytail: a rectangle with no known roll on a vertical run (`sectionOf` returns a band) is drawn
 * as its width x height on an arbitrary roll; a round one is a polygon at its radius.
 */
export function outlineOf(
  sized: Sized,
  center: number[],
  axis: number[],
  roll: number[] | null = null,
): Outline | null {
  const normal = unit(axis);
  const section = normal && sectionOf(sized, normal, roll);
  if (!normal || !section) return null;
  let x: number[], y: number[], w: number, h: number;
  if ("w" in section) ({ x, y, w, h } = section);
  else {
    const seed = Math.abs(normal[2]!) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    x = unit(cross(seed, normal))!;
    y = cross(normal, x);
    [w, h] = sized.shape === "round" ? [section.outer, section.outer] : rectHalves(sized, section);
  }
  const round = !("w" in section) && sized.shape === "round";
  const points = round
    ? Array.from({ length: ROUND_SIDES }, (_, i) => {
        const a = (i / ROUND_SIDES) * Math.PI * 2;
        return add(add(center, x, Math.cos(a) * w), y, Math.sin(a) * h);
      })
    : [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy]) => add(add(center, x, sx! * w), y, sy! * h));
  return { center, normal, points, x, y, w, h };
}
const rectHalves = (s: Sized, band: { outer: number }): [number, number] => {
  const [w, h] = [(s.widthIn ?? 0) / 24, (s.heightIn ?? 0) / 24];
  return w && h ? [w, h] : [band.outer, band.outer];
};

/** An outline's edges, each a pair of corners. */
export const edgesOf = (o: Outline): Edge[] =>
  o.points.map((p, i) => [p, o.points[(i + 1) % o.points.length]!]);

/**
 * The parts of `a`'s edges that lie outside `b` once `b` is laid flat in `a`'s plane: the overhang
 * of `a` over `b`. Cyrus-Beck against `b`'s convex outline; an edge on `b`'s boundary is inside.
 */
export function overhang(a: Outline, b: Outline): Edge[] {
  const flat = b.points.map((p) =>
    sub(
      p,
      a.normal.map((v) => v * dot(sub(p, a.center), a.normal)),
    ),
  );
  const mid = flat[0]!.map((_, k) => flat.reduce((s, p) => s + p[k]!, 0) / flat.length);
  const walls = flat.map((p, i) => {
    const edge = sub(flat[(i + 1) % flat.length]!, p);
    const inward = cross(a.normal, edge);
    return { p, inward: dot(inward, sub(mid, p)) >= 0 ? inward : inward.map((v) => -v) };
  });
  const out: Edge[] = [];
  for (const [s0, s1] of edgesOf(a)) {
    const run = sub(s1, s0);
    let [lo, hi] = [0, 1];
    for (const { p, inward } of walls) {
      const n = unit(inward)!;
      const num = dot(sub(s0, p), n);
      const den = dot(run, n);
      if (Math.abs(den) < 1e-12) {
        if (num < -EPS) hi = -1;
      } else if (den > 0) lo = Math.max(lo, (-EPS - num) / den);
      else hi = Math.min(hi, (EPS + num) / -den);
    }
    const len = Math.hypot(...run);
    const piece = (t0: number, t1: number) => {
      if ((t1 - t0) * len > EPS) out.push([add(s0, run, t0), add(s0, run, t1)]);
    };
    if (lo >= hi) piece(0, 1);
    else {
      piece(0, lo);
      piece(hi, 1);
    }
  }
  return out;
}
