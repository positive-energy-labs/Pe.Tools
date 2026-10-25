import type { Bounds, SceneMeshes, PaintOf } from "./types";
import type { Project } from "./projection";
import { paintOf } from "./grounds";

/** The capture bounds and the subject inside them. */
export type PictureBounds = {
  scene: Bounds;
  subject: Bounds;
  points?: () => Iterable<readonly number[]>;
};

/** Retained subject and stub vertices, excluding context, without keeping a second geometry copy. */
export function* framingPoints(meshes: SceneMeshes) {
  for (const i of meshes.instances)
    if (i.focus)
      for (let n = i.firstVertex * 3; n < (i.firstVertex + i.vertexCount) * 3; n += 3)
        yield [meshes.positions[n]!, meshes.positions[n + 1]!, meshes.positions[n + 2]!];
}

/** Captions clear the retained duct silhouettes as well as other annotations. */
export function captionObstacles(meshes: SceneMeshes, project: Project, paint?: PaintOf) {
  return meshes.instances.flatMap((instance) => {
    if (paintOf(instance, paint).tier === "context") return [];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (
      let n = instance.firstVertex * 3;
      n < (instance.firstVertex + instance.vertexCount) * 3;
      n += 3
    ) {
      const p = project([meshes.positions[n]!, meshes.positions[n + 1]!, meshes.positions[n + 2]!]);
      if (!p) continue;
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    return Number.isFinite(x0) ? [{ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }] : [];
  });
}
