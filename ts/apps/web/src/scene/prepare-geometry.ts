import * as THREE from "three";
import { SceneMeshes, type Bounds, type SceneInstance } from "./types";
import { bakeVeil, type VeilField } from "./veil-field";

export type PreparationInput = {
  positions: Float32Array;
  bounds: Bounds;
  instances: readonly SceneInstance[];
  cuts: SceneMeshes["cuts"];
  subjects: boolean[];
  angles: (number | null)[];
};
export type PreparedGeometry = {
  positions: Float32Array;
  normals: Float32Array;
  continuation: Float32Array;
  boxes: (number[] | null)[];
  spheres: (number[] | null)[];
  edges: (Float32Array | null)[];
  angles: (number | null)[];
  field: VeilField;
};

/** Same Three geometry operations and coordinate rounding as drawing, away from the input thread. */
export function prepareGeometry(input: PreparationInput): PreparedGeometry {
  const meshes = new SceneMeshes(input.positions, input.bounds, input.instances, input.cuts);
  const b = input.bounds;
  const origin = new THREE.Vector3(
    (b.minX + b.maxX) / 2,
    (b.minY + b.maxY) / 2,
    (b.minZ + b.maxZ) / 2,
  );
  const positions = input.positions.slice();
  const normals = new Float32Array(positions.length);
  const continuation = new Float32Array(positions.length / 3).fill(1e6);
  const boxes: (number[] | null)[] = [],
    spheres: (number[] | null)[] = [],
    edges: (Float32Array | null)[] = [];
  for (const [index, instance] of input.instances.entries()) {
    if (instance.primitive) {
      // Native bounds and shared templates are sufficient. Context can contain 118k proxies.
      boxes.push(null);
      spheres.push(null);
      edges.push(null);
      continue;
    }
    const start = instance.firstVertex * 3,
      end = start + instance.vertexCount * 3;
    const vertices = positions.subarray(start, end);
    for (let n = 0; n < vertices.length; n += 3) {
      vertices[n]! -= origin.x;
      vertices[n + 1]! -= origin.y;
      vertices[n + 2]! -= origin.z;
    }
    const geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(vertices, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    normals.set(geometry.getAttribute("normal").array, start);
    boxes.push([...geometry.boundingBox!.min.toArray(), ...geometry.boundingBox!.max.toArray()]);
    spheres.push([...geometry.boundingSphere!.center.toArray(), geometry.boundingSphere!.radius]);
    const cuts = instance.revitId === null ? [] : (input.cuts.get(instance.revitId) ?? []);
    for (const cut of cuts) {
      const normal = new THREE.Vector3()
        .fromArray(cut.at)
        .sub(new THREE.Vector3().fromArray(cut.from))
        .normalize();
      const at = new THREE.Vector3().fromArray(cut.at),
        point = new THREE.Vector3();
      for (let n = instance.firstVertex; n < instance.firstVertex + instance.vertexCount; n++) {
        point.fromArray(input.positions, n * 3);
        continuation[n] = Math.min(continuation[n]!, Math.abs(point.sub(at).dot(normal)));
      }
    }
    const angle = input.angles[index];
    if (angle !== null && angle !== undefined) {
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(input.positions.subarray(start, end), 3),
      );
      const edge = new THREE.EdgesGeometry(geometry, angle);
      edges.push(new Float32Array(edge.getAttribute("position").array));
      edge.dispose();
    } else edges.push(null);
    geometry.dispose();
  }
  return {
    positions,
    normals,
    continuation,
    boxes,
    spheres,
    edges,
    angles: input.angles,
    field: input.instances.length
      ? bakeVeil(meshes, (i) => input.subjects[i]!)
      : { data: new Uint8Array([255]), dims: [1, 1, 1], min: [0, 0, 0], cellFt: 1 },
  };
}
