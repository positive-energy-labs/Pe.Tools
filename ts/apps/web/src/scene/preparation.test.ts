import { afterEach, expect, it, vi } from "vite-plus/test";
import * as THREE from "three";
import { SceneMeshes } from "./types";
import { prepareGeometry } from "./prepare-geometry";
import { preparedCache } from "./prepared-cache";
import { prepareScene } from "./preparation";
import { scenePlan } from "./scene-plan";
import { LOOK } from "./grounds";

const cube = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
const positions = new Float32Array(cube.getAttribute("position").array);
for (let i = 0; i < positions.length; i += 3) positions[i]! += 10000;
const mesh = new SceneMeshes(
  positions,
  { minX: 9999, maxX: 10001, minY: -1, maxY: 1, minZ: -1, maxZ: 1 },
  [
    {
      key: "cube",
      revitId: 42,
      uniqueId: "cube",
      documentKey: "doc",
      linkInstanceId: null,
      category: "Ducts",
      categoryId: null,
      focus: true,
      firstVertex: 0,
      vertexCount: 36,
    },
  ],
  new Map([[42, [{ from: [9999, 0, 0], at: [10000, 0, 0] }]]]),
);
const input = {
  positions: mesh.positions,
  bounds: mesh.bounds,
  instances: mesh.instances,
  cuts: mesh.cuts,
  subjects: [true],
  angles: [30],
};
afterEach(() => {
  preparedCache.clear();
  vi.unstubAllGlobals();
});

it("preserves world edges, rebased bounds, oriented normals and continuation distances without detaching capture data", () => {
  const before = mesh.positions.slice();
  const ready = prepareGeometry(input);
  expect(mesh.positions).toEqual(before);
  expect(ready.boxes).toEqual([[-1, -1, -1, 1, 1, 1]]);
  expect(ready.spheres[0]![3]).toBeCloseTo(Math.sqrt(3));
  expect(ready.edges[0]).toHaveLength(72); // twelve cube creases; no coplanar triangulation diagonals
  expect(Math.min(...ready.edges[0]!.filter((_, i) => i % 3 === 0))).toBe(9999);
  for (let n = 0; n < ready.positions.length; n += 9) {
    const a = new THREE.Vector3().fromArray(ready.positions, n),
      b = new THREE.Vector3().fromArray(ready.positions, n + 3),
      c = new THREE.Vector3().fromArray(ready.positions, n + 6);
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    expect(new THREE.Vector3().fromArray(ready.normals, n).distanceTo(normal)).toBeLessThan(1e-6);
  }
  expect([...ready.continuation]).toEqual(new Array(36).fill(1));
});

it("terminates superseded work and disposal, without detaching the retained geometry", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const a = new AbortController(),
    b = new AbortController();
  const first = prepareScene(scenePlan(mesh, undefined, LOOK.read()), a.signal);
  const rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
  a.abort();
  const second = prepareScene(scenePlan(mesh, undefined, LOOK.read()), b.signal);
  await rejection;
  expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
  const stopped = expect(second).rejects.toMatchObject({ name: "AbortError" });
  b.abort();
  await stopped;
  expect(workers[1]!.terminate).toHaveBeenCalledTimes(1);
  expect(mesh.positions.byteLength).toBe(432);
});
