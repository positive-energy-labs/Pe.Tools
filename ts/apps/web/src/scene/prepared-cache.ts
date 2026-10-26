import type { SceneMeshes } from "./types";
import type { PreparedGeometry } from "./prepare-geometry";

const ids = new WeakMap<SceneMeshes, number>();
let sequence = 0;
let headroom = 0;
const entries = new Map<string, { data: PreparedGeometry; bytes: number; optional: boolean }>();
const bytes = () => [...entries.values()].reduce((n, e) => n + e.bytes, 0);

/** Derived retention uses spare space inside the scene cache's existing admission ceiling.
 * Artifact admission evicts this optional work first; it never narrows an admitted scope. */
export function preparedHeadroom(available: number) {
  headroom = Math.min(32 * 1024 * 1024, Math.max(0, available));
  while (entries.size && bytes() > headroom) entries.delete(entries.keys().next().value!);
}
export function preparedKey(meshes: SceneMeshes, semantics: string) {
  if (!ids.has(meshes)) ids.set(meshes, ++sequence);
  return `${ids.get(meshes)}:${semantics}`;
}
export function preparedGet(key: string) {
  const entry = entries.get(key);
  if (entry) {
    entries.delete(key);
    entries.set(key, entry);
  }
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("scenePerf"))
    performance.mark("scene:derived-cache", {
      detail: {
        hit: !!entry,
        bytes: bytes(),
        headroom,
        entries: entries.size,
        itemBytes: entry?.bytes,
      },
    });
  return entry?.data;
}
export function preparedPut(key: string, data: PreparedGeometry, optional = false) {
  const weight =
    data.positions.byteLength +
    data.normals.byteLength +
    data.continuation.byteLength +
    data.field.data.byteLength +
    data.edges.reduce((n, e) => n + (e?.byteLength ?? 0), 0) +
    JSON.stringify([data.boxes, data.spheres, data.angles]).length * 2 +
    key.length * 2;
  if (weight > headroom) return;
  const focusBytes = [...entries.values()].reduce((n, e) => n + (e.optional ? 0 : e.bytes), 0);
  if (optional && focusBytes + weight > headroom) return;
  entries.delete(key);
  while (entries.size && bytes() + weight > headroom)
    entries.delete([...entries].find(([, e]) => e.optional)?.[0] ?? entries.keys().next().value!);
  entries.set(key, { data, bytes: weight, optional });
}
