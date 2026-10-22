import { z } from "zod";

const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const polyline = z
  .array(z.tuple([z.number().finite(), z.number().finite()]))
  .max(56)
  .refine(
    (points) =>
      points.every(
        (p, i) =>
          i === 0 || Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1]) >= 0.001,
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
  .refine((c) => !c.closed || c.polyline.length >= 3, "A closed cut needs three points");
const view = {
  scene: z.string().regex(/^[a-f0-9]{64}$/),
  camera: point,
  target: point,
  hidden: z.array(z.string().max(4096)).max(50000),
  isolated: z.array(z.string().max(4096)).max(50000).nullable(),
  selected: z.string().max(4096).nullable(),
};
const current = z.strictObject({
  version: z.literal(2),
  ...view,
  /** One canonical cut per axis; the retained volume is the intersection of all three.
   * Frames (u, v | w): top (X, Y | Z), north (-X, Z | Y), east (Y, Z | X). An empty polyline clips nothing. */
  cuts: z.strictObject({ top: cut, north: cut, east: cut }),
});
const empty = { polyline: [], closed: false, offset: 0, keepInside: true };
/** Version 1 had one plan cut plus a straight plane; its plan cut becomes the top cut, the plane is retired. */
const legacy = z
  .object({
    version: z.literal(1),
    ...view,
    polyline,
    keepInside: z.boolean(),
    closed: z.boolean().default(false),
    offset: z.number().finite().default(0),
  })
  .transform(({ polyline, keepInside, closed, offset, version: _, ...rest }) =>
    current.parse({
      ...rest,
      version: 2,
      cuts: {
        top: { polyline: polyline.length > 1 ? polyline : [], closed, offset, keepInside },
        north: empty,
        east: empty,
      },
    }),
  );
export const spaceViewSchema = z.union([current, legacy]);
export type SpaceViewState = z.output<typeof current>;
