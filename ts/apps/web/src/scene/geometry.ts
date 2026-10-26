import type { Bounds, SceneInstance, SceneMeshes } from "./types";

const prepared = new WeakMap<SceneMeshes, ReadonlyMap<SceneInstance, Bounds>>();

/** SceneMeshes is immutable: retain one spatial summary, never another position buffer. */
export function instanceBounds(meshes: SceneMeshes): ReadonlyMap<SceneInstance, Bounds> {
  const held = prepared.get(meshes);
  if (held) return held;
  const result = new Map<SceneInstance, Bounds>();
  const p = meshes.positions;
  for (const instance of meshes.instances) {
    if (!instance.vertexCount) continue;
    const b: Bounds = {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    };
    const end = (instance.firstVertex + instance.vertexCount) * 3;
    for (let i = instance.firstVertex * 3; i < end; i += 3) {
      b.minX = Math.min(b.minX, p[i]!);
      b.minY = Math.min(b.minY, p[i + 1]!);
      b.minZ = Math.min(b.minZ, p[i + 2]!);
      b.maxX = Math.max(b.maxX, p[i]!);
      b.maxY = Math.max(b.maxY, p[i + 1]!);
      b.maxZ = Math.max(b.maxZ, p[i + 2]!);
    }
    result.set(instance, b);
  }
  prepared.set(meshes, result);
  return result;
}

export function* boundsCorners(b: Bounds): Generator<readonly number[]> {
  for (const x of [b.minX, b.maxX])
    for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) yield [x, y, z];
}
