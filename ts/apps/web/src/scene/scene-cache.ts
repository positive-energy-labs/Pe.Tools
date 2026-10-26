/**
 * Decoded PSC1 scenes resident in the browser, shared by every route that draws one (space, ducts).
 * A scene is content-addressed by its artifact id; the stamp's epochs invalidate older captures.
 */
import type { Psc1Metadata } from "./psc1";
import {
  sceneMemory,
  type SceneFootprint,
  type SceneMemory,
  type SceneMemoryRetention,
} from "./scene-memory";

export type SceneData = { metadata: Psc1Metadata; positions: Float32Array };
const footprints = new WeakMap<SceneData, SceneFootprint>();
/** Immutable decoded data shares its metadata estimate and whole PSC1 backing store. */
export function sceneFootprint(data: SceneData): SceneFootprint {
  let footprint = footprints.get(data);
  if (!footprint) {
    footprint = {
      buffers: [data.positions.buffer],
      heapBytes: JSON.stringify(data.metadata).length * 2 + data.metadata.elements.length * 256,
    };
    footprints.set(data, footprint);
  }
  return footprint;
}
/** Preserve the existing admission ceiling and its scope, independently of measured ownership. */
export const sceneAdmissionBytes = (data: SceneData) =>
  data.positions.buffer.byteLength +
  data.positions.byteLength * 4 +
  sceneFootprint(data).heapBytes!;
/** React's development prop logger enumerates changed objects. Geometry must remain opaque. */
export class ResidentScene<T extends SceneData = SceneData> {
  #data: T;
  #memory: SceneMemory;
  constructor(
    readonly id: string,
    readonly bytes: number,
    data: T,
    memory: SceneMemory,
  ) {
    this.#data = data;
    this.#memory = memory;
  }
  get data(): T {
    return this.#data;
  }
  get metadata(): T["metadata"] {
    return this.#data.metadata;
  }
  get positions(): Float32Array {
    return this.#data.positions;
  }
  /** Active consumers remain accounted after retention eviction or revision invalidation. */
  acquire() {
    return this.#memory.acquire("decoded", sceneFootprint(this.#data));
  }
}

/** Content-addressed snapshots, never a claim that the open Revit document is current. */
export class SceneCache<T extends SceneData = SceneData> {
  #entries = new Map<string, { scene: ResidentScene<T>; retention: SceneMemoryRetention }>();
  constructor(readonly memory = sceneMemory) {}

  get entries(): ReadonlyMap<string, ResidentScene<T>> {
    return new Map([...this.#entries].map(([key, held]) => [key, held.scene]));
  }
  get maxBytes() {
    return this.memory.maxAdmissionBytes;
  }
  get maxScenes() {
    return this.memory.maxDecodedScenes;
  }

  get bytes() {
    return [...this.#entries.values()].reduce((sum, held) => sum + held.scene.bytes, 0);
  }

  get(id: string) {
    const held = this.#entries.get(id);
    if (held) {
      this.#entries.delete(id);
      this.#entries.set(id, held);
      held.retention.touch();
    }
    return held?.scene;
  }

  delete(id: string) {
    this.#entries.get(id)?.retention.release();
  }
  clear() {
    for (const id of this.#entries.keys()) this.delete(id);
  }

  put(id: string, data: T) {
    const bytes = sceneAdmissionBytes(data);
    if (bytes > this.maxBytes)
      throw Error("Scene exceeds the resident geometry budget. Narrow the scope.");
    const stamp = data.metadata.stamp;
    // FOOTGUN: scoped captures have different builtUtc at the same epoch. Invalidate by revision.
    for (const [key, { scene: entry }] of this.#entries) {
      const previous = entry.metadata.stamp;
      const sourceChanged = previous.sources.some((before) =>
        stamp.sources.some(
          (after) =>
            before.documentKey === after.documentKey &&
            before.linkInstanceId === after.linkInstanceId &&
            (before.builtAtEpoch !== after.builtAtEpoch || before.dirty !== after.dirty),
        ),
      );
      // New document epochs and rebuilt source partitions invalidate every old scope of that document.
      if (
        previous.hostDocumentKey === stamp.hostDocumentKey &&
        (previous.epoch !== stamp.epoch || sourceChanged)
      )
        this.delete(key);
    }
    this.delete(id);
    const entry = new ResidentScene<T>(id, bytes, data, this.memory);
    let retained = true;
    const retention = this.memory.retain("decoded", sceneFootprint(data), {
      admissionBytes: bytes,
      entryBytes: id.length * 2,
      optional: data.metadata.elements.some((e) => !e.focus),
      evict: () => {
        retained = false;
        if (this.#entries.get(id)?.scene === entry) this.#entries.delete(id);
      },
    });
    if (retained) this.#entries.set(id, { scene: entry, retention });
    return entry;
  }
}
