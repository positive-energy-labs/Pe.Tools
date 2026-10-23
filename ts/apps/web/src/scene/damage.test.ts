import * as THREE from "three";
import { expect, it } from "vite-plus/test";
import { damageLayer } from "./damage";
import { SceneMeshes, type SceneInstance } from "./types";

it("damage keeps mesh and row identity, pulses once per second, and becomes steady for reduced motion", () => {
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
  const targets = [{ key: "equipmentFlows:7", elementId: 7 }];
  const layer = damageLayer(meshes, instance, targets, ["no-flow:7"]);
  const group = new THREE.Group();
  layer.build(group);
  expect(layer.targets).toEqual(targets);
  const mesh = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  expect(group.position.toArray()).toEqual([101, 101, 0]);
  expect(layer.frame!(group, 0, false, false)).toBe(true);
  const low = mesh.material.opacity;
  layer.frame!(group, 0.5, false, false);
  expect(mesh.material.opacity).toBeGreaterThan(low);
  layer.frame!(group, 1, false, false);
  expect(mesh.material.opacity).toBeCloseTo(low);
  expect(layer.frame!(group, 0, true, false)).toBe(false);
  const steady = mesh.material.opacity;
  layer.frame!(group, 0.5, true, false);
  expect(mesh.material.opacity).toBe(steady);
  layer.frame!(group, 0.5, true, true);
  expect(mesh.material.opacity).toBeGreaterThan(steady);
});
