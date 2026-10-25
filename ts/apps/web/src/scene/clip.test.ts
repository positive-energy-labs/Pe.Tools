import { expect, test } from "vite-plus/test";
import { clipMeshes } from "./clip";
import { SceneMeshes, type SceneInstance } from "./types";

test("clips crossing triangles at the duct cut and keeps element identity and unrelated geometry", () => {
  const instance = (id: number, firstVertex: number): SceneInstance => ({
    key: String(id),
    revitId: id,
    documentKey: "doc",
    linkInstanceId: null,
    uniqueId: String(id),
    category: "duct",
    focus: true,
    firstVertex,
    vertexCount: 3,
  });
  const meshes = new SceneMeshes(
    new Float32Array([0, 0, 0, 30, 0, 0, 0, 1, 0, 50, 0, 0, 60, 0, 0, 50, 1, 0]),
    { minX: 0, minY: 0, minZ: 0, maxX: 60, maxY: 1, maxZ: 0 },
    [instance(1, 0), instance(2, 3)],
  );
  const clipped = clipMeshes(meshes, new Map([[1, [{ from: [0, 0, 0], at: [10, 0, 0] }]]]));
  expect(clipped.instances.map((i) => [i.key, i.firstVertex, i.vertexCount])).toEqual([
    ["1", 0, 6],
    ["2", 6, 3],
  ]);
  const own = Array.from(clipped.positions.slice(0, 18));
  expect(Math.max(...own.filter((_, i) => i % 3 === 0))).toBe(10);
  expect(Array.from(clipped.positions.slice(18))).toEqual(Array.from(meshes.positions.slice(9)));
  expect(clipMeshes(meshes, new Map())).toBe(meshes);
  expect(meshes.instances[1]!.firstVertex).toBe(3);
});
