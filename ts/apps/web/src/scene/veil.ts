import * as THREE from "three";
import { CONTEXT_OPACITY_LIMIT } from "./grounds";
import { VEIL_REACH_FT, type VeilField } from "./veil-field";
export { bakeVeil, falloff, veilDistance, VEIL_REACH_FT, type VeilField } from "./veil-field";

/** The reach when no page supplies a Nearby radius; matches the Ducts contract's default
 * (`routes/ducts.ts` contextRadiusFt). One number: the veil's far edge and the stub fade. */
const VEIL_DEFAULT_REACH_FT = 10;

export type VeilLook = { nearFt: number; curve: number; fill: number };

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
    veilFill: { value: 1 },
    scenePass: { value: 1 },
    /** Nearest context depth (the glass pre-pass) and its pixel size; a zero size is off. */
    contextDepth: { value: null as THREE.Texture | null },
    contextDepthSize: { value: new THREE.Vector2() },
    subjectRim: { value: 0 },
    stubFadeFt: { value: 10 },
    stubEndAlpha: { value: 0.5 },
    /** The context ink a stub grades to over its fade (`grounds.context`). */
    stubContext: { value: new THREE.Color(0.6, 0.6, 0.6) },
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

export function setVeilLook(u: VeilUniforms, look: VeilLook, reachFt = VEIL_DEFAULT_REACH_FT) {
  u.veilFar.value = Math.min(reachFt, VEIL_REACH_FT);
  u.veilNear.value = Math.min(look.nearFt, u.veilFar.value);
  u.stubFadeFt.value = u.veilFar.value;
  u.veilCurve.value = look.curve;
  // Context is never opaque, however the fill is set.
  u.veilFill.value = Math.max(0, Math.min(look.fill, CONTEXT_OPACITY_LIMIT));
}

const parsFragment = /* glsl */ `
uniform sampler3D veilField;
uniform vec3 veilMin;
uniform vec3 veilSize;
uniform float veilCell, veilReach, veilNear, veilFar, veilCurve, veilFill;
#ifdef VEIL_TIER
uniform int scenePass;
uniform sampler2D contextDepth;
uniform vec2 contextDepthSize;
uniform float subjectRim;
uniform float stubFadeFt, stubEndAlpha;
uniform vec3 stubContext;
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
  bool stub = c.a < 0.0;
  // 1 subject; 2 stub fill and 6 stub depth (see renderer drawScene); 3 context and envelopes in
  // one sorted pass; 4 envelopes alone; 5 context alone.
  if (context ? (scenePass != 3 && scenePass != 5) : shell ? (scenePass != 3 && scenePass != 4) : stub ? (scenePass != 2 && scenePass != 6) : scenePass != 1) discard;
  if (shell) c.a -= 1.0;
  if (context) {
    // Lines and glass share one ramp (falloff squared); past the reach it is zero.
    c.a = veilFill * t;
    if (c.a < 0.004) discard;
    // Glass: only the nearest context surface at this pixel draws, so sheets never stack. The
    // pre-pass ran this same vertex path, so equal surfaces match to depth-buffer precision; the
    // slack is a few 24-bit ulps. No fwidth term: its slope widens the tolerance at grazing
    // angles, so parallel roof layers (deck, insulation, ceiling) all pass and stack
    // (2026-10-27 Chadds). MSAA is harmless here: the fill's fragments run once per pixel centre,
    // and the pre-pass samples that same centre from a single-sample target.
    if (contextDepthSize.x > 0.0) {
      float nearest = texture(contextDepth, gl_FragCoord.xy / contextDepthSize).r;
      if (gl_FragCoord.z > nearest + 8.0 / 16777216.0) discard;
    }
  } else {
    // Negative batch alpha carries the stub tier without spending another vertex attribute.
    // A stub grades from its system colour at the subject to the context ink over the fade
    // (kaitpw 2026-10-30: "a subtle gradient over the first 10-15 ft"), then reads as context;
    // its alpha eases to the floor rather than vanishing, so a unit's other ports stay legible.
    if (c.a < 0.0) {
      float fade = min(1.0 - smoothstep(0.0, stubFadeFt, d), smoothstep(0.0, stubFadeFt, sceneContinuation));
      c.rgb = mix(stubContext, c.rgb, fade);
      c.a = -c.a * mix(stubEndAlpha, 1.0, fade);
    }
    // Face interiors darken slightly against their rim; this survives the all-translucent view.
    c.rgb *= 1.0 - subjectRim * abs(dot(normalize(sceneNormal), normalize(sceneView)));
  }
#endif
#ifdef VEIL_LINE
  c.a *= t;
  if (c.a < 0.004) discard;
#endif
}`;

/**
 * The fog chunks carry the world point, then three's optional camera-depth fog.
 * `tier` is the batch: a context
 * instance (alpha zero) takes its opacity from d; `line` fades a context crease by the same d. Idempotent.
 */
export function veilMaterial(material: THREE.Material, u: VeilUniforms, kind?: "tier" | "line") {
  const tiered = kind === "tier";
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
    shader.fragmentShader =
      `${tiered ? "#define VEIL_TIER\n" : kind === "line" ? "#define VEIL_LINE\n" : ""}${shader.fragmentShader}`
        .replace("#include <fog_pars_fragment>", `#include <fog_pars_fragment>\n${parsFragment}`)
        .replace("#include <fog_fragment>", "veil(gl_FragColor);\n#include <fog_fragment>");
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|veil${kind ? `-${kind}` : ""}`;
  material.needsUpdate = true;
}
