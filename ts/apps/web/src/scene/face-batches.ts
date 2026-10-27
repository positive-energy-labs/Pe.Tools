import * as THREE from "three";
import type { PreparedGeometry } from "./prepare-geometry";
import type { Paint, SceneInstance, SceneMeshes } from "./types";
import type { SceneGpuMemory } from "./scene-gpu";
import { center } from "./orbit";

type Part = {
  mesh: THREE.BatchedMesh;
  instances: readonly SceneInstance[];
  release(this: void): void;
};
/** The release closure must not capture the asynchronous preparation frame and its face arrays. */
function facePart(mesh: THREE.BatchedMesh, instances: readonly SceneInstance[]): Part {
  let owned = true;
  return {
    mesh,
    instances,
    release() {
      if (!owned) return;
      owned = false;
      mesh.removeFromParent();
      mesh.dispose();
    },
  };
}
type Address = { part: Part; local: number };
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Ownership follows the existing render passes, not focus/context membership. All shells and
 * context remain in ONE back-to-front sort; splitting those by owner would corrupt translucency. */
export class FaceBatches {
  constructor(
    readonly depth: Part | undefined,
    readonly translucent: Part | undefined,
    private readonly addresses: readonly Address[],
  ) {}
  get parts() {
    return [this.depth, this.translucent].filter((p): p is Part => !!p);
  }
  getVisibleAt(id: number) {
    const at = this.addresses[id]!;
    return at.part.mesh.getVisibleAt(at.local);
  }
  setVisibleAt(id: number, visible: boolean) {
    const at = this.addresses[id]!;
    at.part.mesh.setVisibleAt(at.local, visible);
  }
  setColorAt(id: number, color: THREE.Vector4) {
    const at = this.addresses[id]!;
    at.part.mesh.setColorAt(at.local, color);
  }
  addTo(scene: THREE.Scene) {
    for (const part of this.parts) scene.add(part.mesh);
  }
  disposeExcept(keep?: FaceBatches) {
    for (const part of this.parts) {
      if (keep?.parts.some((p) => p.mesh === part.mesh)) continue;
      part.release();
    }
  }
}

/** Compare the actual rendered coordinates and continuation distances. A stable Revit key alone
 * is not geometry identity. No old capture or worker result is retained by a reused GPU owner. */
async function matches(
  part: Part,
  indices: readonly number[],
  next: SceneMeshes,
  ready: PreparedGeometry,
  check: () => void,
) {
  if (indices.length !== part.instances.length) return false;
  const position = part.mesh.geometry.getAttribute("position");
  const continuation = part.mesh.geometry.getAttribute("continuationDistance");
  const origin = part.mesh.position.toArray();
  let started = performance.now();
  for (const [local, index] of indices.entries()) {
    const instance = next.instances[index]!,
      prior = part.instances[local]!;
    if (instance.key !== prior.key || instance.vertexCount !== prior.vertexCount) return false;
    const range = part.mesh.getGeometryRangeAt(part.mesh.getGeometryIdAt(local))!;
    for (let n = 0; n < instance.vertexCount; n++) {
      for (let axis = 0; axis < 3; axis++)
        if (
          Math.fround(next.positions[(instance.firstVertex + n) * 3 + axis]! - origin[axis]!) !==
          position.array[(range.start + n) * 3 + axis]
        )
          return false;
      if (ready.continuation[instance.firstVertex + n] !== continuation.array[range.start + n])
        return false;
    }
    if (performance.now() - started > 8) {
      await pause();
      check();
      started = performance.now();
    }
  }
  return true;
}

export async function prepareFaceBatches(
  next: SceneMeshes,
  ready: PreparedGeometry,
  paints: readonly Paint[],
  material: THREE.Material,
  prior: FaceBatches | undefined,
  check: () => void,
  memory?: SceneGpuMemory,
) {
  const depth: number[] = [],
    translucent: number[] = [];
  paints.forEach((p, i) =>
    (p.tier === "context" || p.tier === "envelope" ? translucent : depth).push(i),
  );
  const addresses: Address[] = [];
  const owned: Part[] = [];
  const make = async (indices: number[], retained?: Part): Promise<Part | undefined> => {
    if (!indices.length) return undefined;
    if (retained && (await matches(retained, indices, next, ready, check))) {
      // Refresh metadata without changing the old owner's picker before atomic publication.
      const part = {
        mesh: retained.mesh,
        instances: indices.map((i) => next.instances[i]!),
        release: retained.release,
      };
      indices.forEach((global, local) => {
        addresses[global] = { part, local };
      });
      return part;
    }
    const mesh = new THREE.BatchedMesh(
      indices.length,
      indices.reduce((n, i) => n + next.instances[i]!.vertexCount, 0),
      0,
      material,
    );
    const allocation = memory?.own(mesh, "staging");
    mesh.position.fromArray(center(next.bounds));
    const part = facePart(
      mesh,
      indices.map((i) => next.instances[i]!),
    );
    owned.push(part);
    let started = performance.now();
    for (const [local, index] of indices.entries()) {
      check();
      const instance = next.instances[index]!,
        start = instance.firstVertex,
        end = start + instance.vertexCount;
      const geometry = new THREE.BufferGeometry()
        .setAttribute(
          "position",
          new THREE.BufferAttribute(ready.positions.subarray(start * 3, end * 3), 3),
        )
        .setAttribute(
          "normal",
          new THREE.BufferAttribute(ready.normals.subarray(start * 3, end * 3), 3),
        )
        .setAttribute(
          "continuationDistance",
          new THREE.BufferAttribute(ready.continuation.subarray(start, end), 1),
        );
      const box = ready.boxes[index]!,
        sphere = ready.spheres[index]!;
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3().fromArray(box),
        new THREE.Vector3().fromArray(box, 3),
      );
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(sphere), sphere[3]);
      mesh.addInstance(mesh.addGeometry(geometry));
      geometry.dispose();
      if (local === 0) allocation?.refresh();
      addresses[index] = { part, local };
      if (performance.now() - started > 8) {
        await pause();
        check();
        started = performance.now();
      }
    }
    allocation?.refresh();
    return part;
  };
  try {
    const kept = await make(depth, prior?.depth);
    const glass = await make(translucent);
    check();
    return new FaceBatches(kept, glass, addresses);
  } catch (error) {
    for (const part of owned) part.release();
    throw error;
  }
}

/** Upload one attribute per task without drawing or clearing a pixel. Three uploads geometry
 * before testing material visibility. Borrow attributes, then detach them before disposing the
 * staging geometry so their buffers remain owned by the real batch. No private renderer APIs. */
export async function uploadFaceBatches(
  renderer: THREE.WebGLRenderer,
  incoming: FaceBatches,
  prior: FaceBatches,
  camera: THREE.Camera,
  check: () => void,
) {
  const material = new THREE.MeshBasicMaterial({ visible: false });
  const stage = new THREE.Scene();
  try {
    for (const part of incoming.parts) {
      if (prior.parts.some((p) => p.mesh === part.mesh)) continue;
      for (const [name, attribute] of Object.entries(part.mesh.geometry.attributes)) {
        check();
        const geometry = new THREE.BufferGeometry().setAttribute(name, attribute);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        stage.add(mesh);
        const clear = renderer.autoClear,
          sort = renderer.sortObjects;
        try {
          renderer.autoClear = false;
          renderer.sortObjects = false;
          renderer.render(stage, camera);
        } finally {
          renderer.autoClear = clear;
          renderer.sortObjects = sort;
          stage.remove(mesh);
          geometry.deleteAttribute(name);
          geometry.dispose();
        }
        await pause();
      }
    }
    check();
  } finally {
    material.dispose();
  }
}
