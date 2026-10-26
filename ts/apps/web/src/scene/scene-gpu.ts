import * as THREE from "three";
import {
  sceneMemory,
  type SceneFootprint,
  type ScenePhase,
  type SceneMemoryLease,
} from "./scene-memory";

/** Allocation identities belong to this WebGL context, even when two viewports share CPU arrays.
 * These are backing-store sizes / GPU payload estimates, never measured driver VRAM. */
export class SceneGpuMemory {
  private leases = new WeakMap<THREE.Object3D, SceneMemoryLease>();
  private keys = new WeakMap<object, object>();
  private key(value: object) {
    let key = this.keys.get(value);
    if (!key) this.keys.set(value, (key = {}));
    return key;
  }
  footprint(root: THREE.Object3D, textures: readonly THREE.Texture[] = []): SceneFootprint {
    const buffers = new Set<ArrayBufferLike>();
    const allocations = new Map<object, number>();
    const array = (value: ArrayBufferView, owner?: object) => {
      buffers.add(value.buffer);
      if (owner) allocations.set(this.key(owner), value.byteLength);
    };
    const texture = (value: THREE.Texture) => {
      const data: unknown = value.image && Reflect.get(value.image, "data");
      if (ArrayBuffer.isView(data)) array(data, value);
    };
    root.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry) {
        for (const attr of [...Object.values(geometry.attributes), geometry.index]) {
          if (!attr) continue;
          const storage = attr instanceof THREE.InterleavedBufferAttribute ? attr.data : attr;
          array(storage.array, storage);
        }
      }
      if (object instanceof THREE.BatchedMesh) {
        // Three exposes no public census for batch-owned textures/draw arrays. Inspect these
        // allocation fields only; rendering never relies on their values or mutates them.
        for (const name of [
          "_matricesTexture",
          "_indirectTexture",
          "_colorsTexture",
          "_multiDrawCounts",
          "_multiDrawStarts",
        ]) {
          const value: unknown = Reflect.get(object, name);
          if (value instanceof THREE.Texture) texture(value);
          else if (ArrayBuffer.isView(value)) array(value);
        }
      }
    });
    textures.forEach(texture);
    return { buffers: [...buffers], gpu: [...allocations].map(([key, bytes]) => ({ key, bytes })) };
  }
  uploaded(root: THREE.Object3D) {
    this.leases.get(root)?.move("uploaded");
  }
  own(root: THREE.Object3D, phase: ScenePhase) {
    const lease = sceneMemory.acquire(phase, this.footprint(root));
    this.leases.set(root, lease);
    const refresh = () => lease.update(this.footprint(root));
    (root as THREE.Mesh).geometry.addEventListener("dispose", () => lease.release());
    return { lease, refresh };
  }
}
