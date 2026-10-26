/**
 * The veil: context opacity follows d = the world
 * distance from a fragment to the nearest opened subject geometry. One rule,
 * camera-independent: orbiting or zooming never changes it. Ground fog and brightness are optional.
 * `falloff` is the rule; the shader
 * mirrors it.
 *
 * d is a baked 3D distance field (one byte per cell, about 2 M cells at most), sampled
 * per fragment by world position. Chosen over a per-vertex attribute because a wall is a few huge
 * triangles whose corners are all far from the ducts, so vertex grain cannot light its middle;
 * and over a uniform array of subject boxes because 4 systems plus stubs are thousands of elements
 * and a duct's box is not the duct. Cost: triangle surface rasterization + 3-pass EDT once per
 * subject change, one texture fetch per fragment. Distance is approximate within two cells
 * (surface samples + trilinear interpolation); the shader treats one cell as touching.
 */
import * as THREE from "three";
import type { SceneMeshes } from "./types";

/** Distances saturate here (ft); a knob's far edge must stay inside it. */
export const VEIL_REACH_FT = 64;
/** Bounded in volume and on each axis (including long, nearly flat scenes). */
// ponytail: a bounded distance texture samples broad wall interiors correctly at one fetch per
// fragment, without per-vertex interpolation misses or a loop over thousands of subject boxes.
const MAX_CELLS = 2 ** 21;
const MAX_AXIS = 256;
const MIN_CELL_FT = 0.5;

/** 1 at the subject (d ≤ near), 0 at and past far, a steep power curve between. */
export function falloff(d: number, nearFt: number, farFt: number, curve: number): number {
  const s = Math.min(1, Math.max(0, (d - nearFt) / Math.max(farFt - nearFt, 1e-3)));
  return (1 - s) ** curve;
}

export type VeilField = {
  data: Uint8Array;
  dims: readonly [number, number, number];
  min: readonly [number, number, number];
  cellFt: number;
};

/** The CPU pick uses the texture's linear sample, including its half-cell centre convention. */
export function veilDistance(field: VeilField, point: readonly number[]): number {
  const at = field.dims.map((n, axis) =>
    Math.max(0, Math.min(n - 1, (point[axis]! - field.min[axis]!) / field.cellFt - 0.5)),
  );
  const [nx, ny] = field.dims;
  let encoded = 0;
  for (let k = 0; k < 8; k++) {
    const indices = at.map((v, axis) =>
      Math.min(field.dims[axis]! - 1, Math.floor(v) + ((k >> axis) & 1)),
    );
    const weight = at.reduce(
      (w, v, axis) => w * ((k >> axis) & 1 ? v - Math.floor(v) : 1 - (v - Math.floor(v))),
      1,
    );
    encoded += field.data[indices[0]! + nx * (indices[1]! + ny * indices[2]!)]! * weight;
  }
  return Math.max(0, (encoded / 255) * (VEIL_REACH_FT + field.cellFt) - field.cellFt);
}

const BIG = 1e12;
/** Felzenszwalb's exact 1D squared distance transform of `f` (length n) into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/** Bake d over the scene bounds. No subject: every cell is at the far edge. */
export function bakeVeil(meshes: SceneMeshes, isSubject: (index: number) => boolean): VeilField {
  const bounds = meshes.bounds;
  const span = [
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  ].map((s) => Math.max(s, 1e-3));
  let cellFt = Math.max(MIN_CELL_FT, Math.max(...span) / MAX_AXIS);
  const dimensions = () =>
    span.map((s) => Math.max(1, Math.ceil(s / cellFt))) as [number, number, number];
  let dims = dimensions();
  while (dims[0] * dims[1] * dims[2] > MAX_CELLS) {
    cellFt *= 1.05;
    dims = dimensions();
  }
  const [nx, ny, nz] = dims;
  const sq = new Float64Array(nx * ny * nz).fill(BIG);
  const min = [bounds.minX, bounds.minY, bounds.minZ] as const;
  const cellOf = (x: number, y: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - min[0]) / cellFt)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - min[1]) / cellFt)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - min[2]) / cellFt)));
    return i + nx * (j + ny * k);
  };
  const p = meshes.positions;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const edge = new THREE.Vector3(),
    temp = new THREE.Vector3();
  const left = new THREE.Vector3(),
    right = new THREE.Vector3();
  let seeded = false;
  meshes.instances.forEach((instance, index) => {
    if (!isSubject(index)) return;
    seeded = true;
    const end = (instance.firstVertex + instance.vertexCount) * 3;
    for (let t = instance.firstVertex * 3; t + 9 <= end; t += 9) {
      a.fromArray(p, t);
      b.fromArray(p, t + 3);
      c.fromArray(p, t + 6);
      // Scan parallel to the longest edge. Work follows surface area, rather than edge² on a
      // long skinny duct face. Half-cell spacing covers large faces without a sample-count cap.
      if (
        b.distanceToSquared(c) > a.distanceToSquared(b) &&
        b.distanceToSquared(c) > a.distanceToSquared(c)
      ) {
        temp.copy(a);
        a.copy(c);
        c.copy(temp);
      } else if (a.distanceToSquared(c) > a.distanceToSquared(b)) {
        temp.copy(b);
        b.copy(c);
        c.copy(temp);
      }
      edge.subVectors(b, a);
      temp.subVectors(c, a);
      const height = temp.addScaledVector(edge, -temp.dot(edge) / (edge.lengthSq() || 1)).length();
      const rows = Math.max(1, Math.ceil(height / (cellFt / 2)));
      for (let row = 0; row <= rows; row++) {
        left.lerpVectors(a, c, row / rows);
        right.lerpVectors(b, c, row / rows);
        const columns = Math.max(1, Math.ceil(left.distanceTo(right) / (cellFt / 2)));
        for (let col = 0; col <= columns; col++) {
          temp.lerpVectors(left, right, col / columns);
          sq[cellOf(temp.x, temp.y, temp.z)] = 0;
        }
      }
    }
  });
  if (!seeded) sq.fill(BIG);
  else {
    const longest = Math.max(nx, ny, nz);
    const f = new Float64Array(longest),
      d = new Float64Array(longest);
    const v = new Int32Array(longest),
      z = new Float64Array(longest + 1);
    const pass = (n: number, count: number, at: (line: number, q: number) => number) => {
      for (let line = 0; line < count; line++) {
        for (let q = 0; q < n; q++) f[q] = sq[at(line, q)]!;
        edt1d(f, n, d, v, z);
        for (let q = 0; q < n; q++) sq[at(line, q)] = d[q]!;
      }
    };
    pass(nx, ny * nz, (line, q) => q + nx * line);
    pass(ny, nx * nz, (line, q) => (line % nx) + nx * (q + ny * Math.floor(line / nx)));
    pass(nz, nx * ny, (line, q) => line + nx * ny * q);
  }
  const data = new Uint8Array(sq.length);
  for (let i = 0; i < sq.length; i++)
    data[i] = Math.min(
      255,
      Math.round(((Math.sqrt(sq[i]!) * cellFt) / (VEIL_REACH_FT + cellFt)) * 255),
    );
  return { data, dims, min, cellFt };
}
