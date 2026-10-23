/**
 * Silhouette outlines for marked elements (selected, lit by a hovered row, under the pointer): the
 * marked geometry is drawn into a mask (one channel per mark), and one full-screen pass rings each
 * silhouette in the page ink with a thin dark casing outside it, so it reads over light ducts and a
 * light ground alike. Constant width in pixels; it follows the true silhouette of any element (a
 * round duct included), and shows through occluders so a selection is never lost behind others.
 */
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

export const OUTLINE_LAYER = 2;
/** Mask channel per mark, strongest first. */
export const OUTLINE_CHANNEL = {
  selected: new THREE.Color(1, 0, 0),
  lit: new THREE.Color(0, 1, 0),
  hover: new THREE.Color(0, 0, 1),
} as const;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const fragmentShader = /* glsl */ `
uniform sampler2D mask;
uniform vec2 texel;
uniform vec3 ink;
uniform vec3 casing;
varying vec2 vUv;
// Widths in device px per channel (selected, lit, hover); the casing adds 1.5 px outside.
const vec3 width = vec3(2.5, 2.0, 1.25);
void main() {
  vec3 inside = texture2D(mask, vUv).rgb;
  vec3 ring = vec3(0.0);
  vec3 outer = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.392699;
    vec2 d = vec2(cos(a), sin(a)) * texel;
    ring = max(ring, vec3(
      texture2D(mask, vUv + d * width.x).r,
      texture2D(mask, vUv + d * width.y).g,
      texture2D(mask, vUv + d * width.z).b));
    outer = max(outer, vec3(
      texture2D(mask, vUv + d * (width.x + 1.5)).r,
      texture2D(mask, vUv + d * (width.y + 1.5)).g,
      texture2D(mask, vUv + d * (width.z + 1.5)).b));
  }
  vec3 line = max(ring - inside, 0.0) * vec3(1.0, 0.9, 0.6);
  vec3 dark = max(outer - max(ring, inside), 0.0) * vec3(0.6, 0.5, 0.3);
  float l = max(line.r, max(line.g, line.b));
  float k = max(dark.r, max(dark.g, dark.b));
  float alpha = l + k * (1.0 - l);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(mix(casing, ink, l / max(alpha, 1e-3)), alpha);
}`;

export function createOutline(
  renderer: THREE.WebGLRenderer,
  ink: THREE.Color,
  casing: THREE.Color,
) {
  const mask = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthBuffer: false });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      mask: { value: mask.texture },
      texel: { value: new THREE.Vector2() },
      ink: { value: ink },
      casing: { value: casing },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);
  const clear = new THREE.Color();
  return {
    setSize(width: number, height: number) {
      const ratio = renderer.getPixelRatio();
      mask.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
      material.uniforms.texel!.value.set(1 / mask.width, 1 / mask.height);
    },
    /** After the picture: draw `scene`'s outline layer through `camera` and ring it. */
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getClearColor(clear);
      const alpha = renderer.getClearAlpha();
      const layers = camera.layers.mask;
      camera.layers.set(OUTLINE_LAYER);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(mask);
      renderer.render(scene, camera);
      camera.layers.mask = layers;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(null);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      quad.render(renderer);
      renderer.autoClear = autoClear;
    },
    dispose() {
      mask.dispose();
      material.dispose();
      quad.dispose();
    },
  };
}
