/**
 * The veil: context fades, and every fogged material fogs toward the ground, by d = the world
 * distance from a fragment to the nearest subject geometry (tier `subject` or `stub`). One rule,
 * camera-independent: orbiting or zooming never changes it. `falloff` is the rule; the shader
 * mirrors it.
 *
 * ponytail: d is a baked 3D distance field (one byte per cell, about 2 M cells at most), sampled
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
const MAX_CELLS = 2 ** 21;
const MAX_AXIS = 256;
const MIN_CELL_FT = 0.5;
/** A context instance carries this alpha; the shader replaces it with the veil's opacity. */
export const CONTEXT_ALPHA = 0;

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
    data[i] = Math.min(255, Math.round(((Math.sqrt(sq[i]!) * cellFt) / VEIL_REACH_FT) * 255));
  return { data, dims, min, cellFt };
}

export type VeilLook = {
  nearFt: number;
  farFt: number;
  curve: number;
  minOpacity: number;
  maxOpacity: number;
  desaturate: number;
  fog: number;
};

/** One uniform set shared by every veiled material of a renderer. */
const fieldTexture = (data: Uint8Array, [nx, ny, nz]: readonly [number, number, number]) =>
  Object.assign(new THREE.Data3DTexture(data, nx, ny, nz), {
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    unpackAlignment: 1,
    needsUpdate: true,
  });

export function veilUniforms() {
  return {
    /** Until a bake lands: one cell at d = 0, so nothing is veiled. */
    veilField: { value: fieldTexture(new Uint8Array(1), [1, 1, 1]) },
    veilMin: { value: new THREE.Vector3() },
    veilSize: { value: new THREE.Vector3(1, 1, 1) },
    veilCell: { value: 0 },
    veilReach: { value: VEIL_REACH_FT },
    veilNear: { value: 0 },
    veilFar: { value: 1 },
    veilCurve: { value: 1 },
    veilMinOpacity: { value: 1 },
    veilMaxOpacity: { value: 1 },
    veilDesaturate: { value: 0 },
    veilFog: { value: 0 },
    veilGround: { value: new THREE.Color() },
  };
}
export type VeilUniforms = ReturnType<typeof veilUniforms>;

export function setVeilField(u: VeilUniforms, field: VeilField) {
  const [nx, ny, nz] = field.dims;
  u.veilField.value.dispose();
  u.veilField.value = fieldTexture(field.data, field.dims);
  u.veilMin.value.set(...field.min);
  u.veilSize.value.set(nx * field.cellFt, ny * field.cellFt, nz * field.cellFt);
  u.veilCell.value = field.cellFt;
}

/** `ground` is the stage colour already in the output colour space, as three's own fog uniform. */
export function setVeilLook(u: VeilUniforms, look: VeilLook, ground: THREE.Color) {
  u.veilNear.value = look.nearFt;
  u.veilFar.value = Math.min(look.farFt, VEIL_REACH_FT);
  u.veilCurve.value = look.curve;
  u.veilMinOpacity.value = look.minOpacity;
  u.veilMaxOpacity.value = look.maxOpacity;
  u.veilDesaturate.value = look.desaturate;
  u.veilFog.value = look.fog;
  ground.getRGB(u.veilGround.value as unknown as THREE.RGB, THREE.SRGBColorSpace);
}

const parsFragment = /* glsl */ `
uniform sampler3D veilField;
uniform vec3 veilMin;
uniform vec3 veilSize;
uniform float veilCell, veilReach, veilNear, veilFar, veilCurve;
uniform float veilMinOpacity, veilMaxOpacity, veilDesaturate, veilFog;
uniform vec3 veilGround;
varying vec3 veilPoint;
void veil(inout vec4 c) {
  float d = max(0.0, texture(veilField, (veilPoint - veilMin) / veilSize).r * veilReach - veilCell);
  float t = pow(1.0 - clamp((d - veilNear) / max(veilFar - veilNear, 1e-3), 0.0, 1.0), veilCurve);
#ifdef VEIL_TIER
  if (c.a <= 0.0) {
    c.a = mix(veilMinOpacity, veilMaxOpacity, t);
    c.rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), veilDesaturate * (1.0 - t));
    if (c.a < 0.004) discard;
  }
#endif
  c.rgb = mix(c.rgb, veilGround, veilFog * (1.0 - t));
}`;

/**
 * Put a fogged material under the veil: its fog chunks gain the world point and the veil term,
 * then three's own depth fog (only when the scene has one). `tiered` is the batch: a context
 * instance (alpha `CONTEXT_ALPHA`) takes its opacity from d. Idempotent.
 */
export function veilMaterial(material: THREE.Material, u: VeilUniforms, tiered = false) {
  if (!(material as { fog?: boolean }).fog || material.userData.veiled) return;
  material.userData.veiled = true;
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <fog_pars_vertex>", "#include <fog_pars_vertex>\nvarying vec3 veilPoint;")
      .replace(
        "#include <fog_vertex>",
        "#include <fog_vertex>\nveilPoint = (inverse(viewMatrix) * mvPosition).xyz;",
      );
    shader.fragmentShader = `${tiered ? "#define VEIL_TIER\n" : ""}${shader.fragmentShader}`
      .replace("#include <fog_pars_fragment>", `#include <fog_pars_fragment>\n${parsFragment}`)
      .replace("#include <fog_fragment>", "veil(gl_FragColor);\n#include <fog_fragment>");
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|veil${tiered ? "-tier" : ""}`;
  material.needsUpdate = true;
}
