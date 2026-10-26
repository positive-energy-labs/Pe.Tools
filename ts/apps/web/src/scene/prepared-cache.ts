import type { SceneMeshes } from "./types";
import type { PreparedGeometry } from "./prepare-geometry";
import { sceneMemory, type SceneFootprint, type SceneMemoryRetention } from "./scene-memory";

const footprints = new WeakMap<PreparedGeometry, SceneFootprint>();
export function preparedFootprint(data: PreparedGeometry): SceneFootprint {
  let footprint = footprints.get(data);
  if (!footprint) {
    footprint = {
      buffers: [
        data.positions.buffer,
        data.normals.buffer,
        data.continuation.buffer,
        data.field.data.buffer,
        ...data.edges.flatMap((e) => (e ? [e.buffer] : [])),
      ],
      heapBytes: JSON.stringify([data.boxes, data.spheres, data.angles]).length * 2,
    };
    footprints.set(data, footprint);
  }
  return footprint;
}

/** A specialised identity/value store; SceneMemory owns every retention/admission decision. */
export class PreparedCache {
  #ids = new WeakMap<SceneMeshes, number>();
  #sequence = 0;
  #entries = new Map<string, { data: PreparedGeometry; retention: SceneMemoryRetention }>();
  constructor(readonly memory = sceneMemory) {}

  key(meshes: SceneMeshes, semantics: string) {
    if (!this.#ids.has(meshes)) this.#ids.set(meshes, ++this.#sequence);
    return `${this.#ids.get(meshes)}:${semantics}`;
  }
  get(key: string) {
    const held = this.#entries.get(key);
    held?.retention.touch();
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("scenePerf")) {
      const retention = this.memory.snapshot().retention;
      performance.mark("scene:derived-cache", {
        detail: {
          hit: !!held,
          bytes: retention.preparedBytes,
          headroom: retention.preparedLimitBytes,
          entries: this.#entries.size,
        },
      });
    }
    return held?.data;
  }
  put(key: string, data: PreparedGeometry, optional = false) {
    this.delete(key);
    let retained = true;
    const retention = this.memory.retain("prepared", preparedFootprint(data), {
      optional,
      entryBytes: key.length * 2,
      evict: () => {
        retained = false;
        if (this.#entries.get(key)?.data === data) this.#entries.delete(key);
      },
    });
    if (retained) this.#entries.set(key, { data, retention });
  }
  delete(key: string) {
    this.#entries.get(key)?.retention.release();
  }
  clear() {
    for (const key of this.#entries.keys()) this.delete(key);
  }
}

export const preparedCache = new PreparedCache();
