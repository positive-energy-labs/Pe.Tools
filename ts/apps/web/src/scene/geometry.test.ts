import { expect, it } from "vite-plus/test";
import { PerspectiveCamera } from "three";
import { instanceBounds } from "./geometry";
import { boundsOfInstances, boundsOfPoints } from "./orbit";
import { captionObstacles, framingPoints } from "./framing";
import { projectThrough } from "./projection";
import { SceneMeshes } from "./types";

const positions = new Float32Array([
  -2, -1, -1, 2, 1, 1, 0, 0, 0, 100, 100, 100, 102, 100, 100, 100, 101, 100,
]);
const bounds = { minX: -2, minY: -1, minZ: -1, maxX: 102, maxY: 101, maxZ: 100 };
const instances = [true, false].map((focus, index) => ({
  key: String(index),
  revitId: index,
  uniqueId: String(index),
  documentKey: "test",
  linkInstanceId: null,
  category: "Ducts",
  categoryId: null,
  focus,
  firstVertex: index * 3,
  vertexCount: 3,
}));
const meshes = new SceneMeshes(positions, bounds, instances);
const size = { width: 900, height: 600 };

it("shares one spatial summary while keeping exact subset bounds and empty scopes", () => {
  expect(instanceBounds(meshes)).toBe(instanceBounds(meshes));
  expect(boundsOfInstances(meshes, () => true)).toEqual(bounds);
  const focus = { minX: -2, minY: -1, minZ: -1, maxX: 2, maxY: 1, maxZ: 1 };
  expect(boundsOfInstances(meshes, (i) => i.focus)).toEqual(focus);
  expect(boundsOfInstances(meshes, () => false)).toBeNull();
  expect(boundsOfPoints(framingPoints(meshes))).toEqual(focus);
  expect([...framingPoints(meshes)]).toHaveLength(8);
});

it("projected boxes contain every sampled vertex in multiple perspective bearings", () => {
  for (const eye of [
    [8, 5, 9],
    [-9, 3, 7],
    [0, -10, 2],
  ]) {
    const camera = new PerspectiveCamera(45, size.width / size.height, 0.05, 1000);
    camera.position.fromArray(eye);
    camera.lookAt(0, 0, 0);
    const project = projectThrough(camera, size);
    const [box] = captionObstacles(meshes, project, undefined, size);
    expect(box).toBeDefined();
    for (let i = 0; i < 9; i += 3) {
      const [x, y] = project(Array.from(positions.subarray(i, i + 3)))!;
      expect(x).toBeGreaterThanOrEqual(box!.x - 1e-6);
      expect(x).toBeLessThanOrEqual(box!.x + box!.width + 1e-6);
      expect(y).toBeGreaterThanOrEqual(box!.y - 1e-6);
      expect(y).toBeLessThanOrEqual(box!.y + box!.height + 1e-6);
    }
  }
});

it("reserves the viewport when a box straddles the eye, and skips boxes wholly behind it", () => {
  const camera = new PerspectiveCamera(45, size.width / size.height, 0.05, 1000);
  expect(captionObstacles(meshes, projectThrough(camera, size), undefined, size)).toEqual([
    { x: 0, y: 0, ...size },
  ]);
  camera.position.z = -10;
  expect(captionObstacles(meshes, projectThrough(camera, size), undefined, size)).toEqual([]);
});
