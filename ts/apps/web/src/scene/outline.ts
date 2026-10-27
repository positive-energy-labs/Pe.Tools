/** Lit elements get silhouettes: selection, row lighting and pointer hover. One depth rule
 * (`LOOK.depth.occluded*`): the part in front of real subject geometry draws bold, the part behind
 * it draws thin and faint in the same hue, constant however deep, so it reads as behind yet stays
 * findable. Translucent context owns no depth here: behind context counts as visible (the
 * renderer composites this after the context pass; see its `drawScene` exception note).
 * The ink and dark casing keep the outline visible on light meshes and ground alike. */
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { BLACK } from "./grounds";

export const OUTLINE_LAYER = 2;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// RGB: each channel's whole silhouette (no depth test). A: where any outlined surface passed the
// depth test against the subject occluders. Visible ring = ring of (channel AND seen).
const fragmentShader = /* glsl */ `
uniform sampler2D mask;
uniform vec2 texel;
uniform vec3 ink;
uniform vec3 casing;
// Widths in device px per channel (selected, lit, hover); the casing adds casingPx outside.
uniform vec3 width;
uniform float casingPx;
uniform float occludedAlpha, occludedWidth;
varying vec2 vUv;
vec3 seen(vec4 s) { return min(s.rgb, vec3(s.a)); }
void main() {
  vec3 inside = texture2D(mask, vUv).rgb;
  vec3 ring = vec3(0.0), outer = vec3(0.0), hidRing = vec3(0.0), hidOuter = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.392699;
    vec2 d = vec2(cos(a), sin(a)) * texel;
    ring = max(ring, vec3(
      seen(texture2D(mask, vUv + d * width.x)).r,
      seen(texture2D(mask, vUv + d * width.y)).g,
      seen(texture2D(mask, vUv + d * width.z)).b));
    outer = max(outer, vec3(
      seen(texture2D(mask, vUv + d * (width.x + casingPx))).r,
      seen(texture2D(mask, vUv + d * (width.y + casingPx))).g,
      seen(texture2D(mask, vUv + d * (width.z + casingPx))).b));
  }
  // The occluded ring is thinner: eight directions suffice and halve its fetches.
  vec3 w = width * occludedWidth;
  float c = casingPx * occludedWidth;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 d = vec2(cos(a), sin(a)) * texel;
    hidRing = max(hidRing, vec3(
      texture2D(mask, vUv + d * w.x).r,
      texture2D(mask, vUv + d * w.y).g,
      texture2D(mask, vUv + d * w.z).b));
    hidOuter = max(hidOuter, vec3(
      texture2D(mask, vUv + d * (w.x + c)).r,
      texture2D(mask, vUv + d * (w.y + c)).g,
      texture2D(mask, vUv + d * (w.z + c)).b));
  }
  vec3 weight = vec3(1.0, 0.9, 0.6), darkWeight = vec3(0.6, 0.5, 0.3);
  vec3 line = max(max(ring - inside, 0.0), max(hidRing - inside, 0.0) * occludedAlpha) * weight;
  vec3 dark = max(
    max(outer - max(ring, inside), 0.0),
    max(hidOuter - max(hidRing, inside), 0.0) * occludedAlpha) * darkWeight;
  float l = max(line.r, max(line.g, line.b));
  float k = max(dark.r, max(dark.g, dark.b));
  float alpha = l + k * (1.0 - l);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(mix(casing, ink, l / max(alpha, 1e-3)), alpha);
}`;

/** The seen pass writes alpha only; the silhouette pass writes colour only. */
const SEEN = {
  depthTest: true,
  blending: THREE.CustomBlending,
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;
const WHOLE = {
  depthTest: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

export function createOutline(
  renderer: THREE.WebGLRenderer,
  ink: THREE.Color,
  casing: THREE.Color,
) {
  const mask = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthBuffer: true });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      mask: { value: mask.texture },
      texel: { value: new THREE.Vector2() },
      ink: { value: ink },
      casing: { value: casing },
      width: { value: new THREE.Vector3() },
      casingPx: { value: 0 },
      occludedAlpha: { value: 0.35 },
      occludedWidth: { value: 0.6 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);
  const clear = new THREE.Color();
  const pass = (group: THREE.Object3D, how: typeof SEEN | typeof WHOLE) =>
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) Object.assign(object.material as THREE.Material, how);
    });
  return {
    /** Device px per channel and the dark casing outside them (`LOOK.outline`). */
    setWidths(w: { selected: number; lit: number; hover: number; casing: number }) {
      material.uniforms.width!.value.set(w.selected, w.lit, w.hover);
      material.uniforms.casingPx!.value = w.casing;
    },
    /** `LOOK.depth`: the occluded part's alpha and width factor. */
    setOccluded(alpha: number, width: number) {
      material.uniforms.occludedAlpha!.value = alpha;
      material.uniforms.occludedWidth!.value = width;
    },
    setSize(width: number, height: number) {
      const ratio = renderer.getPixelRatio();
      mask.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
      material.uniforms.texel!.value.set(1 / mask.width, 1 / mask.height);
    },
    /** `seed` draws the occluders' depth (no colour) into the bound target. */
    render(scene: THREE.Scene, camera: THREE.Camera, group: THREE.Object3D, seed: () => void) {
      renderer.getClearColor(clear);
      const alpha = renderer.getClearAlpha();
      const layers = camera.layers.mask;
      renderer.setClearColor(BLACK, 0);
      renderer.setRenderTarget(mask);
      renderer.clear();
      seed();
      camera.layers.set(OUTLINE_LAYER);
      pass(group, SEEN);
      renderer.render(scene, camera);
      pass(group, WHOLE);
      renderer.render(scene, camera);
      camera.layers.mask = layers;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
    dispose() {
      mask.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
