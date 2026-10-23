/**
 * A selective screen-space halo: objects on `GLOW_LAYER` are drawn into a half-resolution mask,
 * blurred twice (separable Gaussian), and laid over the finished frame. The halo is a constant
 * width in pixels, so a damaged element reads as a beacon at a system-wide fit and as a soft
 * bloom close up. The picture itself never draws `GLOW_LAYER` (cameras see layer 0 only).
 *
 * The composite is alpha over (not additive) so the halo tints a light background as well as
 * lighting a dark one. Costs nothing while no object is on the layer.
 */
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

export const GLOW_LAYER = 1;
/** Glow sources that only feed the halo (a fixed-pixel beacon): never cut out of it. */
export const BEACON_LAYER = 3;

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
  // Outside the source only (mostly): the element's own skin keeps its form under the halo.
  vec4 m = texture2D(mask, vUv);
  vec3 c = max(texture2D(map, vUv).rgb - m.rgb * 0.6, 0.0) * strength;
  float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
  gl_FragColor = vec4(c / max(a, 1e-3), a);
}`;

export function createGlow(renderer: THREE.WebGLRenderer) {
  const target = () =>
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const [mask, a, b] = [target(), target(), target()];
  const blur = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, step: { value: new THREE.Vector2() } },
    vertexShader,
    fragmentShader: blurShader,
    depthTest: false,
    depthWrite: false,
  });
  const composite = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, mask: { value: null }, strength: { value: 2.6 } },
    vertexShader,
    fragmentShader: compositeShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(blur);
  const clear = new THREE.Color();

  const pass = (
    from: THREE.WebGLRenderTarget,
    to: THREE.WebGLRenderTarget,
    x: number,
    y: number,
  ) => {
    blur.uniforms.map!.value = from.texture;
    blur.uniforms.step!.value.set(x / from.width, y / from.height);
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };

  return {
    setSize(width: number, height: number) {
      const ratio = renderer.getPixelRatio() / 2;
      const w = Math.max(1, Math.round(width * ratio));
      const h = Math.max(1, Math.round(height * ratio));
      for (const t of [mask, a, b]) t.setSize(w, h);
    },
    /** After the picture: draw `scene`'s glow layer through `camera` and lay its halo over. */
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getClearColor(clear);
      const alpha = renderer.getClearAlpha();
      const layers = camera.layers.mask;
      camera.layers.set(GLOW_LAYER);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(mask);
      renderer.render(scene, camera);
      // The halo's source is the mask plus the beacons; only the mask is cut out of the halo.
      renderer.setRenderTarget(a);
      renderer.render(scene, camera);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      camera.layers.set(BEACON_LAYER);
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
      camera.layers.mask = layers;
      renderer.setClearColor(clear, alpha);
      pass(a, b, 1, 0);
      pass(b, a, 0, 1);
      pass(a, b, 2.5, 0);
      pass(b, a, 0, 2.5);
      pass(a, b, 5, 0);
      pass(b, a, 0, 5);
      renderer.setRenderTarget(null);
      composite.uniforms.map!.value = a.texture;
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
