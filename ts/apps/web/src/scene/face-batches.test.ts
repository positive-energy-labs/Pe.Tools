import { SceneGpuMemory } from "./scene-gpu";
import { sceneMemory } from "./scene-memory";
import * as THREE from "three";
import { expect, test, vi } from "vite-plus/test";
import { FaceBatches, prepareFaceBatches } from "./face-batches";
import { prepareGeometry } from "./prepare-geometry";
import { createFacePicker } from "./picking";
import { SceneMeshes, type Paint, type SceneInstance } from "./types";

function fixture(context = false, shifted = false) {
  const positions: number[] = [],
    instances: SceneInstance[] = [],
    paints: Paint[] = [];
  for (let i = 0; i < (context ? 3 : 2); i++) {
    const geometry = new THREE.BoxGeometry(2, 2, 1).toNonIndexed();
    geometry.translate(100 + (i === 0 && shifted ? 1 : 0), 200, i * 3);
    const array = geometry.getAttribute("position").array;
    instances.push({
      key: String(i),
      revitId: i,
      uniqueId: String(i),
      documentKey: "doc",
      linkInstanceId: null,
      category: "face",
      categoryId: null,
      focus: i < 2,
      firstVertex: positions.length / 3,
      vertexCount: array.length / 3,
    });
    positions.push(...array);
    geometry.dispose();
    paints.push(
      i === 0
        ? { tier: "subject" }
        : i === 1
          ? { tier: "subject", surface: "shell" }
          : { tier: "context" },
    );
  }
  // The optional capture has a different centre. Reused faces must retain their original origin.
  const meshes = new SceneMeshes(
    new Float32Array(positions),
    { minX: 98, maxX: context ? 120 : 102, minY: 198, maxY: 202, minZ: -1, maxZ: context ? 8 : 4 },
    instances,
  );
  const ready = prepareGeometry({
    positions: meshes.positions,
    bounds: meshes.bounds,
    instances,
    cuts: meshes.cuts,
    subjects: paints.map((p) => p.tier === "subject"),
    angles: paints.map(() => null),
  });
  return { meshes, ready, paints };
}
const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
const build = (f: ReturnType<typeof fixture>, prior?: FaceBatches, check = () => {}) =>
  prepareFaceBatches(f.meshes, f.ready, f.paints, material, prior, check);

test("context retains exact depth buffers while shells and context share one sorted owner", async () => {
  const first = await build(fixture()),
    next = await build(fixture(true), first);
  expect(next.depth!.mesh).toBe(first.depth!.mesh);
  expect(next.translucent!.instances.map((i) => i.key)).toEqual(["1", "2"]);
  expect(next.depth!.mesh.position.x).toBe(100);
  expect(next.translucent!.mesh.position.x).toBe(109);
  const depthDisposed = vi.spyOn(first.depth!.mesh, "dispose");
  const oldGlassDisposed = vi.spyOn(first.translucent!.mesh, "dispose");
  first.disposeExcept(next);
  expect(depthDisposed).not.toHaveBeenCalled();
  expect(oldGlassDisposed).toHaveBeenCalledOnce();
  // Subject priority and clipping cross the two independently rebased GPU owners.
  next.parts.forEach((p) => p.mesh.updateMatrixWorld(true));
  const pick = createFacePicker(next, (i) => (i.focus ? 1 : 0));
  const ray = new THREE.Ray(new THREE.Vector3(100, 200, 10), new THREE.Vector3(0, 0, -1));
  expect(pick(ray)?.instance.key).toBe("1");
  next.setVisibleAt(1, false);
  expect(pick(ray)?.instance.key).toBe("0");
  expect(pick(ray, (p) => p.instance.key !== "0")?.instance.key).toBe("2");
  next.disposeExcept();
  expect(depthDisposed).toHaveBeenCalledOnce();
});

test("same keys with changed rendered geometry do not reuse depth storage", async () => {
  const first = await build(fixture()),
    next = await build(fixture(true, true), first);
  expect(next.depth!.mesh).not.toBe(first.depth!.mesh);
  first.disposeExcept(next);
  next.disposeExcept();
});

test("superseded preparation cannot dispose the still-published depth owner", async () => {
  const first = await build(fixture()),
    disposed = vi.spyOn(first.depth!.mesh, "dispose");
  await expect(
    build(fixture(true), first, () => {
      throw new DOMException("superseded", "AbortError");
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(disposed).not.toHaveBeenCalled();
  expect(first.getVisibleAt(0)).toBe(true);
  first.disposeExcept();
});

test("tier changes require a new pass owner, while colours keep the partition", async () => {
  const f = fixture(true),
    first = await build(f);
  f.paints[0] = { tier: "subject", surface: "shell" };
  const next = await build(f, first);
  expect(next.depth).toBeUndefined();
  expect(next.translucent!.instances.map((i) => i.key)).toEqual(["0", "1", "2"]);
  first.disposeExcept(next);
  next.disposeExcept();
});

test("viewport allocations release independently; reused focus is counted once and incoming rollback preserves it", async () => {
  const baseline = sceneMemory.snapshot().owners.active;
  const firstMemory = new SceneGpuMemory(),
    insetMemory = new SceneGpuMemory();
  const f = fixture();
  const first = await prepareFaceBatches(
    f.meshes,
    f.ready,
    f.paints,
    material,
    undefined,
    () => {},
    firstMemory,
  );
  const firstBytes = sceneMemory.snapshot().owned.gpuEstimateBytes;
  const inset = await prepareFaceBatches(
    f.meshes,
    f.ready,
    f.paints,
    material,
    undefined,
    () => {},
    insetMemory,
  );
  expect(sceneMemory.snapshot().owned.gpuEstimateBytes).toBe(firstBytes * 2);
  const c = fixture(true);
  const incoming = await prepareFaceBatches(
    c.meshes,
    c.ready,
    c.paints,
    material,
    first,
    () => {},
    firstMemory,
  );
  expect(incoming.depth!.mesh).toBe(first.depth!.mesh);
  incoming.disposeExcept(first);
  expect(sceneMemory.snapshot().owned.gpuEstimateBytes).toBe(firstBytes * 2);
  first.disposeExcept();
  expect(sceneMemory.snapshot().owned.gpuEstimateBytes).toBe(firstBytes);
  expect(inset.getVisibleAt(0)).toBe(true);
  inset.disposeExcept();
  expect(sceneMemory.snapshot().owners.active).toBe(baseline);
  expect(sceneMemory.snapshot().owners.reservations).toBe(0);
});

test("closing the viewport during a staged shared-focus replacement releases each allocation once", async () => {
  const old = await build(fixture()),
    incoming = await build(fixture(true), old);
  const released = vi.spyOn(old.depth!.mesh, "dispose");
  old.disposeExcept();
  expect(() => incoming.disposeExcept()).not.toThrow();
  expect(released).toHaveBeenCalledTimes(1);
});
