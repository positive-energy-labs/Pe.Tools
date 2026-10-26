import type { Bounds, SceneMeshes, PaintOf } from "./types";
import type { Project, Size } from "./projection";
import { paintOf } from "./grounds";
import { boundsCorners, instanceBounds } from "./geometry";

/** The capture bounds and the subject inside them. */
export type PictureBounds = {
  scene: Bounds;
  subject: Bounds;
  points?: () => Iterable<readonly number[]>;
};

/** Conservative per-element corners fit the subject without visiting every triangle again. */
export function* framingPoints(meshes: SceneMeshes) {
  for (const [instance, bounds] of instanceBounds(meshes, (i) => i.focus))
    if (instance.focus) yield* boundsCorners(bounds);
}

/** Use the raw camera projection: clipping corners can miss a section through a box's middle.
 * Whole boxes conservatively reserve some cut-away space; captions never overlap kept geometry. */
export function captionObstacles(
  meshes: SceneMeshes,
  project: Project,
  paint: PaintOf | undefined,
  size: Size,
) {
  return [...instanceBounds(meshes, (i) => paintOf(i, paint).tier !== "context")].flatMap(
    ([instance, bounds]) => {
      if (paintOf(instance, paint).tier === "context") return [];
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      let projected = 0;
      for (const corner of boundsCorners(bounds)) {
        const p = project(corner);
        if (!p) continue;
        projected++;
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      // Crossing the eye plane can project to infinity; the visible corners alone underbound it.
      if (projected > 0 && projected < 8) return [{ x: 0, y: 0, ...size }];
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(size.width, x1);
      y1 = Math.min(size.height, y1);
      return x0 <= x1 && y0 <= y1 ? [{ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }] : [];
    },
  );
}
