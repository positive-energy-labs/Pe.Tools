/** Picking uses the same packed vertices and visibility as the picture. */
import * as THREE from "three";
import type { SceneRenderer } from "./renderer";
import type { Pick, SceneInstance } from "./types";
import { falloff } from "./veil-field";
import type { FaceBatches } from "./face-batches";

const CLICK_PX = 5;
export const isClick = (down: { x: number; y: number }, up: { clientX: number; clientY: number }) =>
  Math.hypot(up.clientX - down.x, up.clientY - down.y) <= CLICK_PX;

/** The renderer's unindexed batch shares primitive geometry through instance transforms. Unlike the general
 * BatchedMesh raycast, this needs no normals, UVs, all-hit array or sort: only the nearest kept hit.
 * Read its packed geometry so origin rebasing has exactly the same float32 rounding as drawing. */
export function createMeshPicker(
  batch: THREE.BatchedMesh,
  byId: readonly SceneInstance[],
  priority: (instance: SceneInstance) => number = () => 0,
) {
  const ranges = byId.map((instance, id) => {
    const geometry = batch.getGeometryIdAt(id);
    const range = batch.getGeometryRangeAt(geometry)!;
    const matrix = batch.getMatrixAt(id, new THREE.Matrix4());
    return {
      instance,
      id,
      start: range.start,
      end: range.start + range.count,
      box: batch.getBoundingBoxAt(geometry, new THREE.Box3())!.applyMatrix4(matrix),
      matrix,
      inverse: matrix.clone().invert(),
    };
  });
  const positions = batch.geometry.getAttribute("position");
  const local = new THREE.Ray(),
    inverse = new THREE.Matrix4(),
    instanceRay = new THREE.Ray();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const hit = new THREE.Vector3(),
    world = new THREE.Vector3();
  return (ray: THREE.Ray, clip?: (hit: Pick) => boolean): Pick | null => {
    local.copy(ray).applyMatrix4(inverse.copy(batch.matrixWorld).invert());
    let nearest = Infinity;
    let rank = -Infinity;
    let result: Pick | null = null;
    for (const { instance, id, start, end, box, matrix, inverse: instanceInverse } of ranges) {
      const nextRank = priority(instance);
      if (nextRank < rank) continue;
      if (!batch.getVisibleAt(id) || !local.intersectBox(box, hit)) continue;
      if (
        nextRank === rank &&
        !box.containsPoint(local.origin) &&
        ray.origin.distanceToSquared(world.copy(hit).applyMatrix4(batch.matrixWorld)) > nearest
      )
        continue;
      instanceRay.copy(local).applyMatrix4(instanceInverse);
      for (let i = start; i < end; i += 3) {
        a.fromBufferAttribute(positions, i);
        b.fromBufferAttribute(positions, i + 1);
        c.fromBufferAttribute(positions, i + 2);
        if (!instanceRay.intersectTriangle(a, b, c, false, hit)) continue;
        world.copy(hit).applyMatrix4(matrix).applyMatrix4(batch.matrixWorld);
        const distance = ray.origin.distanceToSquared(world);
        if (nextRank === rank && distance >= nearest) continue;
        const pick: Pick = { instance, point: world.toArray() };
        if (clip && !clip(pick)) continue;
        rank = nextRank;
        nearest = distance;
        result = pick;
      }
    }
    return result;
  };
}

/** Pass ownership must not change inspection's subject-first, nearest-within-tier rule. */
export function createFacePicker(
  batches: FaceBatches,
  priority: (instance: SceneInstance) => number,
) {
  const pickers = batches.parts.map((part) =>
    createMeshPicker(part.mesh, part.instances, priority),
  );
  const point = new THREE.Vector3();
  return (ray: THREE.Ray, clip?: (hit: Pick) => boolean): Pick | null => {
    let result: Pick | null = null,
      rank = -Infinity,
      distance = Infinity;
    for (const picker of pickers) {
      const hit = picker(ray, clip);
      if (!hit) continue;
      const nextRank = priority(hit.instance),
        nextDistance = point.fromArray(hit.point).distanceToSquared(ray.origin);
      if (nextRank > rank || (nextRank === rank && nextDistance < distance)) {
        result = hit;
        rank = nextRank;
        distance = nextDistance;
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

/** The context pane is pickable only where the picture draws it: glass mode, inside the far edge,
 * and at or above the pass's discard threshold (`veil.ts` discards context alpha below 0.004).
 * Creases in lines mode are never a surface the pointer can meet. Same rule as the shader. */
export const CONTEXT_DRAW_ALPHA = 0.004;
export function contextPickable(
  mode: string,
  distance: number,
  look: { near: number; far: number; curve: number; fill: number },
): boolean {
  if (mode !== "glass" || distance >= look.far) return false;
  return look.fill * falloff(distance, look.near, look.far, look.curve) >= CONTEXT_DRAW_ALPHA;
}
