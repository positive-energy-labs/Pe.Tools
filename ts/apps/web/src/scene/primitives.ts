import * as THREE from "three";
import type { SceneInstance, SceneMeshes, ScenePrimitive } from "./types";

const ROUND_SEGMENTS = 32;
export const primitiveKey = (p: ScenePrimitive) =>
  p.kind === "oriented-box" || p.run.shape === "rectangular"
    ? "box"
    : p.run.shape === "round"
      ? "round"
      : `oval:${p.run.widthFt! / p.run.heightFt!}`;

/** Templates are owned by the stage that copies them into its batch, never a global cache. */
export function primitiveTemplate(p: ScenePrimitive): THREE.BufferGeometry {
  if (primitiveKey(p) === "box") return new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  if (p.kind === "run" && p.run.shape === "round")
    return new THREE.CylinderGeometry(0.5, 0.5, 1, ROUND_SEGMENTS)
      .rotateX(Math.PI / 2)
      .toNonIndexed();
  const run = (p as Extract<ScenePrimitive, { kind: "run" }>).run;
  const w = run.widthFt!,
    h = run.heightFt!;
  // Flat oval: two semicircles joined by straight sides. The profile is normalized to width/height.
  const radius = Math.min(w, h) / 2,
    offset = Math.abs(w - h) / 2;
  const ring: { x: number; y: number; nx: number; ny: number }[] = [];
  for (const half of [0, 1])
    for (let i = 0; i <= ROUND_SEGMENTS / 2; i++) {
      const angle = -Math.PI / 2 + half * Math.PI + (i * Math.PI) / (ROUND_SEGMENTS / 2);
      let x = Math.cos(angle) * radius + (half ? -offset : offset),
        y = Math.sin(angle) * radius;
      let nx = Math.cos(angle),
        ny = Math.sin(angle);
      if (h > w) {
        [x, y] = [-y, x];
        [nx, ny] = [-ny, nx];
      }
      const normal = new THREE.Vector2(nx * w, ny * h).normalize();
      ring.push({ x: x / w, y: y / h, nx: normal.x, ny: normal.y });
    }
  const positions: number[] = [],
    normals: number[] = [];
  const side = (at: number, z: number) => {
    const r = ring[at]!;
    positions.push(r.x, r.y, z);
    normals.push(r.nx, r.ny, 0);
  };
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    side(i, -0.5);
    side(j, -0.5);
    side(j, 0.5);
    side(i, -0.5);
    side(j, 0.5);
    side(i, 0.5);
    for (const z of [-0.5, 0.5]) {
      const a = ring[z < 0 ? j : i]!,
        b = ring[z < 0 ? i : j]!;
      positions.push(0, 0, z, a.x, a.y, z, b.x, b.y, z);
      for (let n = 0; n < 3; n++) normals.push(0, 0, Math.sign(z));
    }
  }
  return new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    .setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
}

export function primitiveMatrix(p: ScenePrimitive, origin = new THREE.Vector3()) {
  const matrix = new THREE.Matrix4();
  if (p.kind === "oriented-box") {
    const b = p.box;
    return matrix
      .makeBasis(
        new THREE.Vector3().fromArray(b.axisX),
        new THREE.Vector3().fromArray(b.axisY),
        new THREE.Vector3().fromArray(b.axisZ),
      )
      .scale(new THREE.Vector3().fromArray(b.halfSize).multiplyScalar(2))
      .setPosition(new THREE.Vector3().fromArray(b.center).sub(origin));
  }
  const r = p.run,
    start = new THREE.Vector3().fromArray(r.start),
    end = new THREE.Vector3().fromArray(r.end);
  const tangent = end.clone().sub(start),
    length = tangent.length();
  tangent.normalize();
  const x = new THREE.Vector3().fromArray(r.crossSectionXAxis);
  x.addScaledVector(tangent, -x.dot(tangent)).normalize();
  const y = new THREE.Vector3().crossVectors(tangent, x).normalize();
  return matrix
    .makeBasis(x, y, tangent)
    .scale(
      new THREE.Vector3(
        r.shape === "round" ? r.diameterFt! : r.widthFt!,
        r.shape === "round" ? r.diameterFt! : r.heightFt!,
        length,
      ),
    )
    .setPosition(start.add(end).multiplyScalar(0.5).sub(origin));
}

/** Temporary world triangles for clipping, marks and sampling only; the main draw stays instanced. */
export function instancePositions(meshes: SceneMeshes, instance: SceneInstance): Float32Array {
  if (!instance.primitive)
    return meshes.positions.subarray(
      instance.firstVertex * 3,
      (instance.firstVertex + instance.vertexCount) * 3,
    );
  const geometry = primitiveTemplate(instance.primitive).applyMatrix4(
    primitiveMatrix(instance.primitive),
  );
  const positions = geometry.getAttribute("position").array as Float32Array;
  geometry.dispose();
  return positions;
}

/** Proxy edges are derived only while drawing visible lines; no edge soup per context row. */
export function primitiveEdges(p: ScenePrimitive, angle: number): Float32Array {
  if (primitiveKey(p) === "box") {
    const matrix = primitiveMatrix(p),
      point = new THREE.Vector3(),
      positions: number[] = [];
    for (let axis = 0; axis < 3; axis++)
      for (let corner = 0; corner < 8; corner++) {
        if (corner & (1 << axis)) continue;
        for (const at of [corner, corner | (1 << axis)]) {
          point
            .set(at & 1 ? 0.5 : -0.5, at & 2 ? 0.5 : -0.5, at & 4 ? 0.5 : -0.5)
            .applyMatrix4(matrix);
          positions.push(point.x, point.y, point.z);
        }
      }
    return new Float32Array(positions);
  }
  const geometry = primitiveTemplate(p);
  const edges = new THREE.EdgesGeometry(geometry, angle).applyMatrix4(primitiveMatrix(p));
  const positions = edges.getAttribute("position").array as Float32Array;
  edges.dispose();
  geometry.dispose();
  return positions;
}
