/**
 * Decoded PSC1 scenes resident in the browser, shared by every route that draws one (space, ducts).
 * A scene is content-addressed by its artifact id; the stamp's epochs invalidate older captures.
 */
import type { Psc1Metadata } from "./psc1";

export type SceneData = { metadata: Psc1Metadata; positions: Float32Array };
/** React's development prop logger enumerates changed objects. Geometry must remain opaque. */
export class ResidentScene<T extends SceneData = SceneData> {
  #data: T;
  constructor(
    readonly id: string,
    readonly bytes: number,
    data: T,
  ) {
    this.#data = data;
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
}

/** Content-addressed snapshots, never a claim that the open Revit document is current. */
export class SceneCache<T extends SceneData = SceneData> {
  readonly entries = new Map<string, ResidentScene<T>>();
  constructor(
    readonly maxBytes = 512 * 1024 * 1024,
    readonly maxScenes = 32,
    private readonly onHeadroom: (bytes: number) => void = () => {},
  ) {}

  get bytes() {
    return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  }

  get(id: string) {
    const entry = this.entries.get(id);
    if (entry) {
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
    return entry;
  }

  put(id: string, data: T) {
    // PSC1 buffer + merged CPU positions/normals + GPU positions/normals. This is a per-snapshot
    // allocation proxy, not renderer admission or driver VRAM. Entry count is independent of bytes.
    const bytes =
      data.positions.buffer.byteLength +
      data.positions.byteLength * 4 +
      JSON.stringify(data.metadata).length * 2 +
      data.metadata.elements.length * 256;
    if (bytes > this.maxBytes)
      throw Error("Scene exceeds the resident geometry budget. Narrow the scope.");
    const stamp = data.metadata.stamp;
    // FOOTGUN: scoped captures have different builtUtc at the same epoch. Invalidate by revision.
    for (const [key, entry] of this.entries) {
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
        this.entries.delete(key);
    }
    this.entries.delete(id);
    const entry = new ResidentScene<T>(id, bytes, data);
    while (
      this.entries.size &&
      (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxScenes)
    )
      // Prefer retaining the small exact focuses that make navigation usable over optional context.
      // Within each tier retain LRU order; both tiers share the same byte and entry limits.
      this.entries.delete(
        [...this.entries].find(([, entry]) => entry.metadata.elements.some((e) => !e.focus))?.[0] ??
          this.entries.keys().next().value!,
      );
    this.entries.set(id, entry);
    this.onHeadroom(this.maxBytes - this.bytes);
    return entry;
  }
}
