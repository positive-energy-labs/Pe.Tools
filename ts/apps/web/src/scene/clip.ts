import { SceneMeshes } from "./types";
import { instancePositions } from "./primitives";

/** Keep the union of these half spaces for an instance; absent instances retain their mesh. */
export type MeshCut = { from: readonly number[]; at: readonly number[] };

export function clipMeshes(meshes: SceneMeshes, cuts: ReadonlyMap<number, readonly MeshCut[]>) {
  if (!cuts.size) return meshes;
  const positions: number[] = [];
  const instances = meshes.instances.flatMap((instance) => {
    const firstVertex = positions.length / 3;
    const planes = instance.revitId == null ? undefined : cuts.get(instance.revitId);
    if (instance.primitive && !planes) return [{ ...instance, firstVertex, vertexCount: 0 }];
    const source = instancePositions(meshes, instance);
    if (!planes) {
      for (const value of source) positions.push(value);
    } else {
      for (let i = 0; i < source.length; i += 9) {
        const triangle = [0, 3, 6].map((k) => Array.from(source.subarray(i + k, i + k + 3)));
        for (const { from, at } of planes) {
          const normal = at.map((v, k) => from[k]! - v);
          const side = (p: number[]) => p.reduce((sum, v, k) => sum + (v - at[k]!) * normal[k]!, 0);
          const polygon: number[][] = [];
          for (let k = 0; k < 3; k++) {
            const a = triangle[k]!,
              b = triangle[(k + 1) % 3]!;
            const da = side(a),
              db = side(b);
            const aInside = da >= 0;
            const bInside = db >= 0;
            if (aInside) polygon.push(a);
            if (aInside !== bInside)
              polygon.push(a.map((v, axis) => v + ((b[axis]! - v) * da) / (da - db)));
          }
          for (let k = 1; k < polygon.length - 1; k++)
            positions.push(...polygon[0]!, ...polygon[k]!, ...polygon[k + 1]!);
        }
      }
    }
    const vertexCount = positions.length / 3 - firstVertex;
    const clipped = { ...instance, firstVertex, vertexCount };
    delete clipped.primitive;
    return vertexCount ? [clipped] : [];
  });
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (let i = 0; i < positions.length; i += 3) {
    bounds.minX = Math.min(bounds.minX, positions[i]!);
    bounds.maxX = Math.max(bounds.maxX, positions[i]!);
    bounds.minY = Math.min(bounds.minY, positions[i + 1]!);
    bounds.maxY = Math.max(bounds.maxY, positions[i + 1]!);
    bounds.minZ = Math.min(bounds.minZ, positions[i + 2]!);
    bounds.maxZ = Math.max(bounds.maxZ, positions[i + 2]!);
  }
  for (const instance of instances)
    if (instance.primitive) {
      const b = instance.primitive.bounds;
      bounds.minX = Math.min(bounds.minX, b.minX);
      bounds.maxX = Math.max(bounds.maxX, b.maxX);
      bounds.minY = Math.min(bounds.minY, b.minY);
      bounds.maxY = Math.max(bounds.maxY, b.maxY);
      bounds.minZ = Math.min(bounds.minZ, b.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, b.maxZ);
    }
  return new SceneMeshes(
    new Float32Array(positions),
    instances.length ? bounds : meshes.bounds,
    instances,
    cuts,
  );
}
