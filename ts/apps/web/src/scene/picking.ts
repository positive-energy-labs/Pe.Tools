/** What the pointer is over. Hidden elements never answer (BatchedMesh skips them); what a caller
 * cut away is its own business, through `clip`. */
import * as THREE from "three";
import type { SceneRenderer } from "./renderer";
import type { Pick } from "./types";

/** A press that travels further than this is a gesture, not a click (the spike's threshold). */
const CLICK_PX = 5;
export const isClick = (down: { x: number; y: number }, up: { clientX: number; clientY: number }) =>
  Math.hypot(up.clientX - down.x, up.clientY - down.y) <= CLICK_PX;

const ray = new THREE.Raycaster();

/** The nearest element under the pointer that `clip` keeps (false = the caller cut it away). */
export function pickAt(
  r: SceneRenderer,
  at: { clientX: number; clientY: number },
  clip?: (hit: Pick) => boolean,
): Pick | null {
  const rect = r.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  ray.setFromCamera(
    new THREE.Vector2(
      ((at.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((at.clientY - rect.top) / rect.height) * 2,
    ),
    r.camera,
  );
  for (const hit of ray.intersectObject(r.batch)) {
    const instance = hit.batchId === undefined ? undefined : r.byId[hit.batchId];
    if (!instance) continue;
    const pick: Pick = { instance, point: hit.point.toArray() };
    if (!clip || clip(pick)) return pick;
  }
  return null;
}
