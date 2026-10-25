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
 * and a duct's box is not the duct. Cost: one bake per subject change (seed + 3-pass exact EDT,
 * O(cells)), one texture fetch per fragment, nothing per frame. Limit: a cell is the grain, so the
 * shader treats anything within one cell as touching.
 */
import * as THREE from "three";
import type { SceneMeshes } from "./types";

/** Distances saturate here (ft); a knob's far edge must stay inside it. */
export const VEIL_REACH_FT = 64;
/** Field resolution: about 128³ cells, never finer than half a foot. */
const MAX_CELLS = 2 ** 21;
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

/** Bake d over the scene bounds: zero in cells the subject's triangles touch. No subject: all zero. */
export function bakeVeil(meshes: SceneMeshes, isSubject: (index: number) => boolean): VeilField {
  const b = meshes.bounds;
  const span = [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ].map((s) => Math.max(s, 1e-3));
  const cellFt = Math.max(MIN_CELL_FT, Math.cbrt((span[0]! * span[1]! * span[2]!) / MAX_CELLS));
  const dims = span.map((s) => Math.max(1, Math.ceil(s / cellFt))) as [number, number, number];
  const [nx, ny, nz] = dims;
  const sq = new Float64Array(nx * ny * nz).fill(BIG);
  const min = [b.minX, b.minY, b.minZ] as const;
  const cellOf = (x: number, y: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - min[0]) / cellFt)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - min[1]) / cellFt)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - min[2]) / cellFt)));
    return i + nx * (j + ny * k);
  };
  const p = meshes.positions;
  let seeded = false;
  meshes.instances.forEach((instance, index) => {
    if (!isSubject(index)) return;
    seeded = true;
    const end = (instance.firstVertex + instance.vertexCount) * 3;
    for (let t = instance.firstVertex * 3; t + 9 <= end; t += 9) {
      const ax = p[t]!, ay = p[t + 1]!, az = p[t + 2]!;
      const ux = p[t + 3]! - ax, uy = p[t + 4]! - ay, uz = p[t + 5]! - az;
      const vx = p[t + 6]! - ax, vy = p[t + 7]! - ay, vz = p[t + 8]! - az;
      // Sample the triangle at half a cell so a long duct face seeds every cell it crosses.
      const edge = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz));
      const n = Math.min(256, Math.ceil(edge / (cellFt / 2)));
      for (let i = 0; i <= n; i++)
        for (let j = 0; i + j <= n; j++) {
          const a = i / Math.max(n, 1), c = j / Math.max(n, 1);
          sq[cellOf(ax + a * ux + c * vx, ay + a * uy + c * vy, az + a * uz + c * vz)] = 0;
        }
    }
  });
  if (!seeded) sq.fill(0);
  else {
    const longest = Math.max(nx, ny, nz);
    const f = new Float64Array(longest), d = new Float64Array(longest);
    const v = new Int32Array(longest), z = new Float64Array(longest + 1);
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
