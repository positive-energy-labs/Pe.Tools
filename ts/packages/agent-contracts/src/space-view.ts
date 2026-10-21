import { z } from "zod";

const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const spaceViewSchema = z
  .strictObject({
    version: z.literal(1),
    scene: z.string().regex(/^[a-f0-9]{64}$/),
    camera: point,
    target: point,
    hidden: z.array(z.string().max(4096)).max(50000),
    isolated: z.array(z.string().max(4096)).max(50000).nullable(),
    selected: z.string().max(4096).nullable(),
    plane: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable()
      .refine((p) => !p || Math.hypot(p[0], p[1], p[2]) > 0, "Plane normal must be nonzero"),
    polyline: z
      .array(z.tuple([z.number().finite(), z.number().finite()]))
      .max(56)
      .refine(
        (points) =>
          points.every(
            (p, i) =>
              i === 0 || Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1]) >= 0.001,
          ),
        "Cut points must be distinct",
      ),
    keepInside: z.boolean(),
    /** A closed cut keeps its own polygon; an open cut extends its ends to the scope boundary. */
    closed: z.boolean().default(false),
    /** Parallel shift of the cut in feet, toward the left of the drawing direction. */
    offset: z.number().finite().default(0),
  })
  .refine((s) => !s.closed || s.polyline.length >= 3, "A closed cut needs three points");
export type SpaceViewState = z.infer<typeof spaceViewSchema>;
