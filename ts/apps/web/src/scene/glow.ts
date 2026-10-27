/** Full-resolution silhouettes, half-resolution blur. Alpha-over tints light and dark themes;
 * only the glow pass sees GLOW_LAYER, and the renderer skips it when there are no sources. */
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { BLACK } from "./grounds";

export const GLOW_LAYER = 1;
/** Model geometry seeds the masks' depth without painting their colour. */
export const OCCLUDER_LAYER = 4;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const blurShader = /* glsl */ `
uniform sampler2D map;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec4 sum = texture2D(map, vUv) * 0.227027;
  sum += (texture2D(map, vUv + step * 1.384615) + texture2D(map, vUv - step * 1.384615)) * 0.316216;
  sum += (texture2D(map, vUv + step * 3.230769) + texture2D(map, vUv - step * 3.230769)) * 0.070270;
  gl_FragColor = sum;
}`;

const compositeShader = /* glsl */ `
uniform sampler2D map;
uniform sampler2D mask;
uniform float strength;
varying vec2 vUv;
void main() {
  // Full-resolution coverage preserves the mesh edge; half-resolution colour never cuts it out.
  vec3 c = texture2D(map, vUv).rgb * (1.0 - texture2D(mask, vUv).a) * strength;
  float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
  gl_FragColor = vec4(c / max(a, 1e-3), a);
}`;

export function createGlow(renderer: THREE.WebGLRenderer) {
  const mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const blur = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, step: { value: new THREE.Vector2() } },
    vertexShader,
    fragmentShader: blurShader,
    depthTest: false,
    depthWrite: false,
  });
  const composite = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, mask: { value: null }, strength: { value: 0 } },
    vertexShader,
    fragmentShader: compositeShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(blur);
  const clear = new THREE.Color();
  /** Blur step scale; the steps are 1, 2.5 and 5 px at 1. */
  let spread = 1;

  const pass = (
    from: THREE.WebGLRenderTarget,
    to: THREE.WebGLRenderTarget,
    x: number,
    y: number,
  ) => {
    blur.uniforms.map!.value = from.texture;
    const ratio = renderer.getPixelRatio() / (from === mask ? 1 : 2);
    blur.uniforms.step!.value.set(
      (x * spread * ratio) / from.width,
      (y * spread * ratio) / from.height,
    );
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };

  return {
    /** `LOOK.glow`: halo gain and blur spread. */
    setLook(look: { strength: number; spread: number }) {
      composite.uniforms.strength!.value = look.strength;
      spread = look.spread;
    },
    setSize(width: number, height: number) {
      const ratio = renderer.getPixelRatio();
      const w = Math.max(1, Math.round(width * ratio));
      const h = Math.max(1, Math.round(height * ratio));
      mask.setSize(w, h);
      for (const t of [a, b])
        t.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    },
    /** `seed` draws the occluders' depth (no colour) into the bound target: one shared rule. */
    render(scene: THREE.Scene, camera: THREE.Camera, seed: () => void) {
      renderer.getClearColor(clear);
      const alpha = renderer.getClearAlpha();
      const layers = camera.layers.mask;
      const autoClear = renderer.autoClear;
      renderer.setClearColor(BLACK, 0);
      renderer.setRenderTarget(mask);
      renderer.clear();
      renderer.autoClear = false;
      seed();
      camera.layers.set(GLOW_LAYER);
      renderer.render(scene, camera);
      renderer.autoClear = true;
      camera.layers.mask = layers;
      renderer.setClearColor(clear, alpha);
      pass(mask, a, 1, 0);
      pass(a, b, 0, 1);
      pass(b, a, 2.5, 0);
      pass(a, b, 0, 2.5);
      pass(b, a, 5, 0);
      pass(a, b, 0, 5);
      renderer.setRenderTarget(null);
      composite.uniforms.map!.value = b.texture;
      composite.uniforms.mask!.value = mask.texture;
      quad.material = composite;
      renderer.autoClear = false;
      quad.render(renderer);
      renderer.autoClear = autoClear;
      quad.material = blur;
    },
    dispose() {
      for (const t of [mask, a, b]) t.dispose();
      blur.dispose();
      composite.dispose();
      quad.dispose();
    },
  };
}
