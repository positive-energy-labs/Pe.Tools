/**
 * A face pass draws lit only with the lights three collects for it, and three collects a light only
 * when its layers meet the camera's (WebGLRenderer `object.layers.test(camera.layers)`). The stub
 * fill renders with the camera on the stub layer alone, so a light missing that layer drew every
 * stub unlit black: MUAS-1's RV-15 stubs graded black to context grey, never colour to grey
 * (D8 E4, 2026-10-30).
 */
import * as THREE from "three";
import { expect, it } from "vite-plus/test";
import { LIT_FACE_LAYERS, sceneLights } from "./renderer";

it("every face pass, the stub fill included, is lit by both lights", () => {
  const { hemisphere, sun } = sceneLights();
  const camera = new THREE.PerspectiveCamera();
  for (const [pass, layer] of Object.entries(LIT_FACE_LAYERS)) {
    camera.layers.set(layer);
    expect([pass, hemisphere.layers.test(camera.layers), sun.layers.test(camera.layers)]).toEqual([
      pass,
      true,
      true,
    ]);
  }
});
