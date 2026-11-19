import { z } from "zod";

/** Canonical authored geometry validation, shared by Page decode and local preview. */
export function validateCutPolyline(
  points: [number, number][],
  closed: boolean,
  crossingMessage = "Cut crosses itself",
) {
  const n = points.length,
    edges = closed ? n : n - 1;
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1]];
  const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
  for (let i = 0; i < edges; i++) {
    const a = points[i],
      b = points[(i + 1) % n],
      ab = sub(b, a);
    if (Math.hypot(...ab) < 0.001) throw new Error("Cut points must be distinct");
    for (let j = i + 2; j < edges; j++) {
      if (closed && i === 0 && j === edges - 1) continue;
      const c = points[j],
        d = points[(j + 1) % n],
        cd = sub(d, c),
        denom = cross(ab, cd);
      if (Math.abs(denom) < 1e-10) {
        if (
          Math.abs(cross(sub(c, a), ab)) < 1e-8 &&
          [0, 1].every(
            (k) =>
              Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k])) <=
              Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k])) + 1e-8,
          )
        )
          throw new Error("Cut edges overlap");
      } else {
        const t = cross(sub(c, a), cd) / denom,
          u = cross(sub(c, a), ab) / denom;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) throw new Error(crossingMessage);
      }
    }
    const next = i + 1 < edges ? points[(i + 2) % n] : undefined;
    if (next) {
      const after = sub(next, b);
      if (Math.abs(cross(ab, after)) < 1e-10 && ab[0] * after[0] + ab[1] * after[1] < 0)
        throw new Error("Cut folds back");
    }
  }
  // Translate before the area sum so large host coordinates do not erase a small area.
  if (
    closed &&
    n &&
    Math.abs(
      points.reduce(
        (s, p, i) => s + cross(sub(p, points[0]), sub(points[(i + 1) % n], points[0])),
        0,
      ),
    ) < 1e-8
  )
    throw new Error("Cut must enclose an area");
}

/** Offset remains in double host feet until the renderer packs its own local frame. */
export function offsetSpaceCut(cut: {
  polyline: [number, number][];
  closed: boolean;
  offset: number;
}): [number, number][] {
  type Point = [number, number];
  const p = cut.polyline;
  if (p.length < 2 || cut.offset === 0) return p.map((p) => [...p]);
  const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
  const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
  const add = (a: Point, d: Point, t: number): Point => [a[0] + d[0] * t, a[1] + d[1] * t];
  const direction = (a: Point, b: Point): Point => {
    const d = sub(b, a),
      length = Math.hypot(...d);
    if (length < 0.001) throw new Error("Cut points must be distinct");
    return [d[0] / length, d[1] / length];
  };
  return p.flatMap((at, i): Point[] => {
    const before =
      i > 0 ? direction(p[i - 1], at) : cut.closed ? direction(p[p.length - 1], at) : null;
    const after =
      i < p.length - 1 ? direction(at, p[i + 1]) : cut.closed ? direction(at, p[0]) : null;
    const shift = (d: Point) => add(at, [-d[1], d[0]], cut.offset);
    if (!before) {
      if (!after) throw new Error("A cut needs at least two points");
      return [shift(after)];
    }
    if (!after) return [shift(before)];
    const a = shift(before),
      b = shift(after),
      denom = cross(before, after);
    if (Math.abs(denom) < 1e-8) {
      if (before[0] * after[0] + before[1] * after[1] < 0) throw new Error("Cut folds back");
      return [a];
    }
    const join = add(a, before, cross(sub(b, a), after) / denom);
    return Math.hypot(...sub(join, at)) <= Math.abs(cut.offset) * 4 ? [join] : [a, b];
  });
}

const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const polyline = z
  .array(z.tuple([z.number().finite(), z.number().finite()]))
  .max(56)
  .refine(
    (points) =>
      points.every(
        (p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) >= 0.001,
      ),
    "Cut points must be distinct",
  );
/** One cut, drawn in its axis frame (u, v) and extruded along that frame's w across the scene. */
const cut = z
  .strictObject({
    polyline,
    /** A closed cut keeps its own polygon; an open cut extends its ends to the scope boundary. */
    closed: z.boolean(),
    /** Parallel shift of the cut in feet, toward the left of the drawing direction. */
    offset: z.number().finite(),
    keepInside: z.boolean(),
  })
  .refine((c) => c.polyline.length !== 1, "A cut needs at least two points")
  .refine((c) => !c.closed || c.polyline.length >= 3, "A closed cut needs three points")
  .superRefine((c, ctx) => {
    try {
      validateCutPolyline(c.polyline, c.closed);
      const shifted = offsetSpaceCut(c);
      validateCutPolyline(shifted, c.closed);
      if (shifted.length + (!c.closed && shifted.length ? 6 : 0) > 64)
        throw new Error("Cut exceeds the 64 packed point limit");
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid cut",
      });
    }
  });
/** A captured scene's content hash. */
export const spaceSceneSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** One canonical cut per axis; the retained volume is the intersection of all three.
 * Frames (u, v | w): top (X, Y | Z), north (-X, Z | Y), east (Y, Z | X). An empty polyline clips nothing. */
export const spaceCutsSchema = z.strictObject({ top: cut, north: cut, east: cut });
export const emptySpaceCut = { polyline: [], closed: false, offset: 0, keepInside: true };
const view = {
  scene: spaceSceneSchema,
  camera: point,
  target: point,
  hidden: z.array(z.string().max(4096)).max(50000),
  isolated: z.array(z.string().max(4096)).max(50000).nullable(),
  selected: z.string().max(4096).nullable(),
};
export const spaceViewSchema = z.strictObject({
  version: z.literal(2),
  ...view,
  cuts: spaceCutsSchema,
});
export type SpaceViewState = z.output<typeof spaceViewSchema>;
