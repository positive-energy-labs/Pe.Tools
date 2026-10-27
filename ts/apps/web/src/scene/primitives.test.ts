import * as THREE from "three";
import { expect, test } from "vite-plus/test";
import { SceneMeshes, type SceneInstance, type ScenePrimitive } from "./types";
import { primitiveMatrix, primitiveTemplate } from "./primitives";
import { prepareGeometry } from "./prepare-geometry";
import { prepareFaceBatches } from "./face-batches";
import { createFacePicker } from "./picking";
import { instanceBounds } from "./geometry";
import { clipMeshes } from "./clip";
import { sectionCaps } from "./section-caps";
import { bakeVeil, veilDistance } from "./veil-field";
import { SceneGpuMemory } from "./scene-gpu";
import { sceneMemory } from "./scene-memory";
import { damageLayers } from "./damage";

const bounds = { minX: 99, minY: 198, minZ: 0, maxX: 101, maxY: 202, maxZ: 10 };
const run = (shape: "round" | "rectangular" | "oval" = "rectangular"): ScenePrimitive => ({
  kind: "run",
  bounds,
  run: {
    start: [100, 200, 0],
    end: [100, 200, 10],
    shape,
    crossSectionXAxis: [0, 1, 0],
    ...(shape === "round" ? { diameterFt: 2 } : { widthFt: 4, heightFt: 2 }),
  },
});
const instance = (primitive: ScenePrimitive, id = 1): SceneInstance => ({
  key: String(id),
  revitId: id,
  uniqueId: String(id),
  documentKey: "test",
  linkInstanceId: null,
  category: "Ducts",
  categoryId: -2008000,
  focus: true,
  firstVertex: 0,
  vertexCount: 0,
  primitive,
});
const scene = (instances: SceneInstance[]) =>
  new SceneMeshes(new Float32Array(), bounds, instances);
const prepare = (meshes: SceneMeshes, context = false) =>
  prepareGeometry({
    positions: meshes.positions,
    bounds: meshes.bounds,
    instances: meshes.instances,
    cuts: meshes.cuts,
    subjects: meshes.instances.map(() => !context),
    angles: meshes.instances.map(() => 30),
  });

test("native fitting triangles and compact runs coexist in the same render pass", async () => {
  const fitting = { ...instance(run(), 2), firstVertex: 0, vertexCount: 3 };
  delete fitting.primitive;
  const pipe = { ...instance(run("round")), firstVertex: 3 };
  const meshes = new SceneMeshes(new Float32Array([99, 198, 0, 101, 198, 0, 100, 200, 2]), bounds, [
    fitting,
    pipe,
  ]);
  const material = new THREE.MeshLambertMaterial();
  const batches = await prepareFaceBatches(
    meshes,
    prepare(meshes),
    [{ tier: "subject" }, { tier: "subject" }],
    material,
    undefined,
    () => {},
  );
  try {
    expect(batches.depth!.instances.map((i) => i.key)).toEqual(["2", "1"]);
    expect(batches.depth!.mesh.getGeometryIdAt(0)).not.toBe(batches.depth!.mesh.getGeometryIdAt(1));
    expect(meshes.positions.length).toBe(9);
  } finally {
    batches.disposeExcept();
    material.dispose();
  }
});

test("rolled width axis governs the rendered and picked cross-section, including visibility and clipping", async () => {
  const meshes = scene([instance(run())]),
    ready = prepare(meshes);
  const material = new THREE.MeshLambertMaterial();
  const batches = await prepareFaceBatches(
    meshes,
    ready,
    [{ tier: "subject" }],
    material,
    undefined,
    () => {},
  );
  try {
    batches.depth!.mesh.updateMatrixWorld(true);
    const pick = createFacePicker(batches, () => 1),
      ray = new THREE.Ray(new THREE.Vector3(110, 201.5, 5), new THREE.Vector3(-1, 0, 0));
    expect(pick(ray)?.instance.key).toBe("1");
    expect(pick(ray)?.point[0]).toBeCloseTo(101);
    expect(pick(ray, () => false)).toBeNull();
    batches.setVisibleAt(0, false);
    expect(pick(ray)).toBeNull();
    batches.setVisibleAt(0, true);
    expect(pick(ray)?.instance.revitId).toBe(1);
    expect(instanceBounds(meshes).get(meshes.instances[0]!)).toEqual(bounds);
    expect(ready.positions.byteLength).toBe(0);
    expect(ready.edges).toEqual([null]);
  } finally {
    batches.disposeExcept();
    material.dispose();
  }
});

test.each([false, true])(
  "flat oval has straight sides and circular ends at either aspect orientation (%s)",
  (tall) => {
    const primitive = run("oval");
    if (primitive.kind !== "run") throw Error("run fixture");
    primitive.run.crossSectionXAxis = [1, 0, 0];
    primitive.run.start = [0, 0, 0];
    primitive.run.end = [0, 0, 10];
    primitive.run.widthFt = tall ? 2 : 4;
    primitive.run.heightFt = tall ? 4 : 2;
    const geometry = primitiveTemplate(primitive).applyMatrix4(primitiveMatrix(primitive));
    try {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual(
        tall ? [2, 4, 10] : [4, 2, 10],
      );
      const p = geometry.getAttribute("position"),
        points = Array.from({ length: p.count }, (_, i) =>
          new THREE.Vector3().fromBufferAttribute(p, i),
        );
      // A flat top contains both tangent points. An ellipse with these bounds cannot have them.
      expect(
        points.some((p) =>
          tall
            ? Math.abs(p.x + 1) < 1e-6 && Math.abs(p.y - 1) < 1e-6
            : Math.abs(p.x - 1) < 1e-6 && Math.abs(p.y - 1) < 1e-6,
        ),
      ).toBe(true);
      expect(
        points.some((p) =>
          tall
            ? Math.abs(p.x + 1) < 1e-6 && Math.abs(p.y + 1) < 1e-6
            : Math.abs(p.x + 1) < 1e-6 && Math.abs(p.y - 1) < 1e-6,
        ),
      ).toBe(true);
      const n = geometry.getAttribute("normal");
      expect(Array.from(n.array).every(Number.isFinite)).toBe(true);
    } finally {
      geometry.dispose();
    }
  },
);

test("run stubs cut to actual triangles while untouched boxes retain their compact identity", () => {
  const box = instance({ kind: "box", bounds: { ...bounds, minX: 120, maxX: 122 } }, 2);
  box.focus = false;
  const meshes = scene([instance(run()), box]);
  const clipped = clipMeshes(meshes, new Map([[1, [{ from: [100, 200, 0], at: [100, 200, 4] }]]]));
  const cut = clipped.instances[0]!;
  expect(cut.primitive).toBeUndefined();
  expect(cut.vertexCount).toBeGreaterThan(0);
  expect(instanceBounds(clipped).get(cut)!.maxZ).toBeCloseTo(4);
  expect(clipped.instances[1]!.primitive).toBe(box.primitive);
  expect(clipped.instances[1]!.key).toBe("2");
  expect(clipped.bounds.maxX).toBe(122);
  const caps = sectionCaps(scene([instance(run())]), {
    kind: "plane",
    axis: "z",
    offset: 5,
    keep: "below",
  });
  expect(caps).toHaveLength(1);
  expect(caps[0]!.positions.length).toBeGreaterThan(0);
  const field = bakeVeil(scene([instance(run())]), () => true);
  expect(veilDistance(field, [100, 202, 5])).toBeLessThan(1);
  expect(
    damageLayers(scene([instance(run())]), [
      { key: "issue", ids: [1], damage: "wrong", findings: [] },
    ]),
  ).toHaveLength(1);
});

test("a large context keeps zero mesh buffers, one shared box template and releases staged ownership", async () => {
  const count = 20_000;
  const meshes = scene(
    Array.from({ length: count }, (_, i) => ({
      ...instance({ kind: "box", bounds }, i + 1),
      focus: false,
    })),
  );
  const ready = prepare(meshes, true);
  expect(
    ready.positions.byteLength + ready.normals.byteLength + ready.continuation.byteLength,
  ).toBe(0);
  expect(ready.edges.every((e) => e === null)).toBe(true);
  expect(ready.boxes.every((e) => e === null)).toBe(true);
  const baseline = sceneMemory.snapshot().owners.active,
    material = new THREE.MeshLambertMaterial();
  const batches = await prepareFaceBatches(
    meshes,
    ready,
    meshes.instances.map(() => ({ tier: "context" })),
    material,
    undefined,
    () => {},
    new SceneGpuMemory(),
  );
  try {
    const batch = batches.translucent!.mesh;
    expect(batch.getGeometryIdAt(0)).toBe(batch.getGeometryIdAt(count - 1));
    expect(batch.geometry.getAttribute("position").count).toBe(36);
    const footprint = new SceneGpuMemory().footprint(batch);
    expect(footprint.buffers!.reduce((n, b) => n + b.byteLength, 0)).toBeLessThan(count * 256);
    expect(sceneMemory.snapshot().owners.active).toBe(baseline + 1);
  } finally {
    batches.disposeExcept();
    material.dispose();
  }
  expect(sceneMemory.snapshot().owners.active).toBe(baseline);
});
