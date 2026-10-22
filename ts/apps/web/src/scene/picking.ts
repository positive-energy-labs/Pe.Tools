/** Picking uses the same packed vertices and visibility as the picture. */
import * as THREE from "three";
import type { SceneRenderer } from "./renderer";
import type { Pick, SceneInstance } from "./types";

const CLICK_PX = 5;
export const isClick = (down: { x: number; y: number }, up: { clientX: number; clientY: number }) =>
  Math.hypot(up.clientX - down.x, up.clientY - down.y) <= CLICK_PX;

/** The renderer's static, unindexed batch has identity instance transforms. Unlike the general
 * BatchedMesh raycast, this needs no normals, UVs, all-hit array or sort: only the nearest kept hit.
 * Read its packed geometry so origin rebasing has exactly the same float32 rounding as drawing. */
export function createMeshPicker(batch: THREE.BatchedMesh, byId: readonly SceneInstance[]) {
  const ranges = byId.map((instance, id) => {
    const geometry = batch.getGeometryIdAt(id);
    const range = batch.getGeometryRangeAt(geometry)!;
    return {
      instance,
      id,
      start: range.start,
      end: range.start + range.count,
      box: batch.getBoundingBoxAt(geometry, new THREE.Box3())!,
    };
  });
  const positions = batch.geometry.getAttribute("position");
  const local = new THREE.Ray(),
    inverse = new THREE.Matrix4();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const hit = new THREE.Vector3(),
    world = new THREE.Vector3();
  return (ray: THREE.Ray, clip?: (hit: Pick) => boolean): Pick | null => {
    local.copy(ray).applyMatrix4(inverse.copy(batch.matrixWorld).invert());
    let nearest = Infinity;
    let result: Pick | null = null;
    for (const { instance, id, start, end, box } of ranges) {
      if (!batch.getVisibleAt(id) || !local.intersectBox(box, hit)) continue;
      if (!box.containsPoint(local.origin) && local.origin.distanceToSquared(hit) > nearest)
        continue;
      for (let i = start; i < end; i += 3) {
        a.fromBufferAttribute(positions, i);
        b.fromBufferAttribute(positions, i + 1);
        c.fromBufferAttribute(positions, i + 2);
        if (!local.intersectTriangle(a, b, c, false, hit)) continue;
        const distance = local.origin.distanceToSquared(hit);
        if (distance >= nearest) continue;
        world.copy(hit).applyMatrix4(batch.matrixWorld);
        const pick: Pick = { instance, point: world.toArray() };
        if (clip && !clip(pick)) continue;
        nearest = distance;
        result = pick;
      }
    }
    return result;
  };
}

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
/** The nearest visible element that survives the caller's section cuts. */
export function pickAt(
  r: SceneRenderer,
  at: { clientX: number; clientY: number },
  clip?: (hit: Pick) => boolean,
): Pick | null {
  const rect = r.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  pointer.set(
    ((at.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((at.clientY - rect.top) / rect.height) * 2,
  );
  ray.setFromCamera(pointer, r.active());
  return r.pick(ray.ray, clip);
}
