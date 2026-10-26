import * as THREE from "three";
import { CONTEXT_OPACITY_LIMIT } from "./grounds";
import { VEIL_REACH_FT, type VeilField } from "./veil-field";
export { bakeVeil, falloff, veilDistance, VEIL_REACH_FT, type VeilField } from "./veil-field";

export type VeilLook = {
  interior?: number;
  silhouettePower?: number;
  nearFt: number;
  farFt: number;
  curve: number;
  minOpacity: number;
  maxOpacity: number;
  desaturate: number;
  fog: number;
  brightness: number;
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
    veilHalo: { value: false },
    veilBrightness: { value: 0 },
    veilInterior: { value: 1 },
    veilSilhouettePower: { value: 3 },
    scenePass: { value: 1 },
    subjectRim: { value: 0 },
    stubFadeFt: { value: 10 },
    stubEndAlpha: { value: 0.06 },
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
  // Keep the far edge beyond the one-cell contact correction, even on very large scenes.
  u.veilReach.value = VEIL_REACH_FT + field.cellFt;
}

/** `ground` is the stage colour already in the output colour space, as three's own fog uniform. */
export function setVeilLook(u: VeilUniforms, look: VeilLook, ground: THREE.Color) {
  u.veilNear.value = look.nearFt;
  u.veilFar.value = Math.min(look.farFt, VEIL_REACH_FT);
  u.veilCurve.value = look.curve;
  // Even crossed knobs cannot make far context stronger or context fully opaque.
  u.veilMaxOpacity.value = Math.max(0, Math.min(look.maxOpacity, CONTEXT_OPACITY_LIMIT));
  u.veilMinOpacity.value = Math.max(0, Math.min(look.minOpacity, u.veilMaxOpacity.value));
  u.veilDesaturate.value = look.desaturate;
  u.veilFog.value = look.fog;
  u.veilBrightness.value = look.brightness;
  u.veilInterior.value = look.interior ?? 1;
  u.veilSilhouettePower.value = look.silhouettePower ?? 3;
  ground.getRGB(u.veilGround.value as unknown as THREE.RGB, THREE.SRGBColorSpace);
}

const parsFragment = /* glsl */ `
uniform sampler3D veilField;
uniform vec3 veilMin;
uniform vec3 veilSize;
uniform float veilCell, veilReach, veilNear, veilFar, veilCurve;
uniform float veilMinOpacity, veilMaxOpacity, veilDesaturate, veilFog;
uniform vec3 veilGround;
uniform bool veilHalo;
uniform float veilBrightness;
uniform float veilInterior, veilSilhouettePower;
#ifdef VEIL_TIER
uniform int scenePass;
uniform float subjectRim;
uniform float stubFadeFt, stubEndAlpha;
varying vec3 sceneNormal, sceneView;
varying float sceneContinuation;
#endif
varying vec3 veilPoint;
void veil(inout vec4 c) {
  float d = max(0.0, texture(veilField, (veilPoint - veilMin) / veilSize).r * veilReach - veilCell);
  float t = pow(1.0 - clamp((d - veilNear) / max(veilFar - veilNear, 1e-3), 0.0, 1.0), veilCurve);
#ifdef VEIL_TIER
  bool context = c.a == 0.0;
  bool shell = c.a > 1.0;
  if ((context || shell) ? scenePass != 3 : scenePass != 1) discard;
  float facing = abs(dot(normalize(sceneNormal), normalize(sceneView)));
  if (shell) c.a -= 1.0;
  if (context) {
    if (veilHalo && d >= veilFar) discard;
    c.a = veilHalo ? veilMaxOpacity * t : mix(veilMinOpacity, veilMaxOpacity, t);
    c.a *= mix(veilInterior, 1.0, pow(1.0 - facing, veilSilhouettePower));
    c.rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), veilDesaturate * (1.0 - t));
    c.rgb *= 1.0 + veilBrightness * t;
    if (c.a < 0.004) discard;
    c.rgb = mix(c.rgb, veilGround, veilFog * (1.0 - t));
  } else {
    // Negative batch alpha carries the stub tier without spending another vertex attribute.
    if (c.a < 0.0) {
      float fade = min(1.0 - smoothstep(0.0, stubFadeFt, d), smoothstep(0.0, stubFadeFt, sceneContinuation));
      c.a = -c.a * mix(stubEndAlpha, 1.0, fade);
    }
    // Face interiors darken slightly against their rim; this survives the all-translucent view.
    c.rgb *= 1.0 - subjectRim * abs(dot(normalize(sceneNormal), normalize(sceneView)));
  }
#endif
}`;

/**
 * The fog chunks carry the world point, then three's optional camera-depth fog.
 * `tiered` is the batch: a context
 * instance (alpha zero) takes its opacity from d. Idempotent.
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
    if (tiered)
      shader.vertexShader =
        `attribute float continuationDistance;\nvarying float sceneContinuation;\nvarying vec3 sceneNormal, sceneView;\n${shader.vertexShader}`
          .replace(
            "#include <defaultnormal_vertex>",
            "#include <defaultnormal_vertex>\nsceneNormal = transformedNormal;",
          )
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\nsceneContinuation = continuationDistance;\nsceneView = isOrthographic ? vec3(0.0, 0.0, 1.0) : -mvPosition.xyz;",
          );
    shader.fragmentShader = `${tiered ? "#define VEIL_TIER\n" : ""}${shader.fragmentShader}`
      .replace("#include <fog_pars_fragment>", `#include <fog_pars_fragment>\n${parsFragment}`)
      .replace("#include <fog_fragment>", "veil(gl_FragColor);\n#include <fog_fragment>");
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|veil${tiered ? "-tier" : ""}`;
  material.needsUpdate = true;
}
