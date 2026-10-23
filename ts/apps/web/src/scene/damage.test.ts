import * as THREE from "three";
import { expect, it } from "vite-plus/test";
import { damageLayer, heartbeat, setDamageHue } from "./damage";
import { landing } from "./marks";
import { SceneMeshes, type LayerFrame, type SceneInstance } from "./types";

const instance: SceneInstance = {
  key: "unit",
  revitId: 7,
  documentKey: "doc",
  uniqueId: "unit",
  linkInstanceId: null,
  category: "Mechanical Equipment",
  focus: true,
  firstVertex: 0,
  vertexCount: 3,
};
const meshes = new SceneMeshes(
  new Float32Array([100, 100, 0, 102, 100, 0, 100, 102, 0]),
  { minX: 100, minY: 100, minZ: 0, maxX: 102, maxY: 102, maxZ: 0 },
  [instance],
);

it("beats lub-dub then rests, and lands with an eased swell", () => {
  const curve = Array.from({ length: 150 }, (_, i) => heartbeat(i / 100));
  const peak = curve.indexOf(Math.max(...curve));
  expect(curve[peak]).toBeGreaterThan(0.95);
  // A second, smaller beat follows the first; the back half of the period is rest.
  expect(Math.max(...curve.slice(peak + 20, peak + 45))).toBeGreaterThan(0.45);
  expect(Math.max(...curve.slice(90, 150))).toBeLessThan(0.02);
  expect(heartbeat(0.15)).toBeCloseTo(heartbeat(1.65));
  expect(landing(0)).toBe(1);
  expect(landing(0.3)).toBeLessThan(landing(0.1));
  expect(landing(Infinity)).toBe(0);
});

it("damage keeps mesh and row identity, beats, flashes once, and holds still for reduced motion", () => {
  const targets = [{ key: "equipmentFlows:7", elementId: 7 }];
  const alarm = new THREE.Color(0.3, 0.1, 0.05);
  setDamageHue(alarm);
  const layer = damageLayer(meshes, instance, targets, ["no-flow:7"]);
  const group = new THREE.Group();
  layer.build(group);
  const born = performance.now() / 1000;
  expect(layer.targets).toEqual(targets);
  expect(group.position.toArray()).toEqual([101, 101, 0]);
  const skin = group.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  expect(skin.material.uniforms.core!.value).toEqual(alarm);
  const energy = () => skin.material.uniforms.energy!.value as number;
  const at = (seconds: number, extra: Partial<LayerFrame> = {}): LayerFrame => ({
    seconds,
    reducedMotion: false,
    state: "rest",
    landed: Infinity,
    ...extra,
  });
  // The hit flash at birth outshines any later beat.
  expect(layer.frame!(group, at(born))).toBe(true);
  const flash = energy();
  layer.frame!(group, at(born + 3.1));
  expect(energy()).toBeLessThan(flash);
  // Reduced motion: no frames requested, the same energy at any time, hover still reads.
  expect(layer.frame!(group, at(born + 5, { reducedMotion: true }))).toBe(false);
  const steady = energy();
  layer.frame!(group, at(born + 5.4, { reducedMotion: true }));
  expect(energy()).toBe(steady);
  layer.frame!(group, at(born + 5.4, { reducedMotion: true, state: "hover" }));
  expect(energy()).toBeGreaterThan(steady);
});
