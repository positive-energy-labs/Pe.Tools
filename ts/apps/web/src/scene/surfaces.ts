import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { Look } from "./grounds";
import type { Paint, SceneInstance, SceneMeshes } from "./types";

/** Batch alpha encodes the pass: zero context, negative stub, >1 envelope, else subject. */
export function surfaceAlpha(paint: Paint, look: Look) {
  if (paint.tier === "context") return 0;
  if (paint.surface === "shell") return 1 + look.shell.opacity;
  const ceiling = look.depth.everythingTranslucent ? look.depth.translucentOpacity : 1;
  return paint.tier === "stub"
    ? -Math.min(look.subject.stubOpacity, ceiling)
    : look.depth.everythingTranslucent
      ? ceiling
      : look.subject.opacity;
}

/** Cache only admitted envelopes, never crease-expand the surrounding building. */
export function shellEdges(meshes: SceneMeshes) {
  const cache = new Map<SceneInstance, { angle: number; positions: Float32Array }>();
  return (instance: SceneInstance, angle: number) => {
    const hit = cache.get(instance);
    if (hit?.angle === angle) return hit.positions;
    const geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(
        meshes.positions.slice(
          instance.firstVertex * 3,
          (instance.firstVertex + instance.vertexCount) * 3,
        ),
        3,
      ),
    );
    const edges = new THREE.EdgesGeometry(geometry, angle);
    const positions = new Float32Array(edges.getAttribute("position").array);
    edges.dispose();
    geometry.dispose();
    cache.set(instance, { angle, positions });
    return positions;
  };
}

/** One outline draw, irrespective of the number of equipment instances. */
export function shellLines(positions: number[], color: THREE.Color, look: Look) {
  return new LineSegments2(
    new LineSegmentsGeometry().setPositions(positions),
    new LineMaterial({
      color,
      linewidth: look.shell.edgeWidth,
      opacity: look.shell.edgeOpacity,
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
}
