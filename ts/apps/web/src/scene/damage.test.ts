import * as THREE from "three";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { expect, it } from "vite-plus/test";
import {
  damageLayers,
  damageMark,
  damageLayer,
  heartbeat,
  setDamageHue,
  damageAppearance,
} from "./damage";
import { createDamageBatch } from "./damage-batch";
import { landing, markFrame, markLines } from "./marks";
import { BLACK, WHITE, paintOf, GROUND_MATERIAL } from "./grounds";
import { SceneMeshes, type LayerFrame, type SceneInstance } from "./types";

const instance: SceneInstance = {
  key: "unit",
  revitId: 7,
  documentKey: "doc",
  uniqueId: "unit",
  linkInstanceId: null,
  category: "Mechanical Equipment",
  categoryId: null,
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

it("damage batches keep identity, share packed geometry, and yield only the selected element", () => {
  const targets = [{ key: "equipmentFlows:7", elementId: 7 }];
  const second = { ...instance, key: "second", revitId: 8 };
  const firstLayer = damageLayer(meshes, instance, targets, ["no-flow:7"]);
  const secondLayer = damageLayer(meshes, second, [{ key: "flow:8", elementId: 8 }], []);
  const group = new THREE.Group();
  firstLayer.build(group);
  const proxy = group.children[0] as THREE.Mesh;
  expect(proxy.visible).toBe(false);
  expect(proxy.geometry.getAttribute("position").array.buffer).toBe(meshes.positions.buffer);
  expect(firstLayer.targets).toEqual(targets);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(100.5, 100.5, 2), new THREE.Vector3(0, 0, -1));
  expect(ray.intersectObject(group, true)).toHaveLength(1);

  setDamageHue(new THREE.Color(0.3, 0.1, 0.05));
  const batch = createDamageBatch([firstLayer, secondLayer], { value: 0.35 });
  const draws = batch.group.children as THREE.BatchedMesh[];
  expect(draws).toHaveLength(4);
  // Front skin and glow test depth normally; the occluded pair draws only behind subject depth.
  expect(draws.map((draw) => (draw.material as THREE.Material).depthFunc)).toEqual([
    THREE.LessEqualDepth,
    THREE.LessEqualDepth,
    THREE.GreaterDepth,
    THREE.GreaterDepth,
  ]);
  expect(draws.every((draw) => (draw.material as THREE.Material).depthTest)).toBe(true);
  for (const draw of draws)
    expect(draw.material).toMatchObject({
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
  expect(new Set(draws.map((draw) => draw.geometry)).size).toBe(1);
  const at = (extra: Partial<LayerFrame> = {}): LayerFrame => ({
    seconds: firstLayer.damage!.born + 3,
    reducedMotion: false,
    state: "rest",
    landed: Infinity,
    ...extra,
  });
  expect(batch.update(firstLayer, at())).toBe(false);
  expect(batch.update(secondLayer, at({ selected: true }))).toBe(false);
  expect(draws.map((draw) => draw.getVisibleAt(0))).toEqual([true, true, false, false]);
  expect(draws.map((draw) => draw.getVisibleAt(1))).toEqual([true, true, true, true]);
  const normal = draws[0]!.getColorAt(0, new THREE.Vector4());
  const selected = draws[2]!.getColorAt(1, new THREE.Vector4());
  expect(selected.y).toBeCloseTo(normal.y * 0.4);
  batch.update(secondLayer, at({ shown: () => false }));
  expect(draws.every((draw) => !draw.getVisibleAt(1))).toBe(true);
  const born = firstLayer.damage!.born;
  expect(batch.update(firstLayer, at({ seconds: born }))).toBe(true);
  expect(batch.update(firstLayer, at({ state: "focus", landed: 0 }))).toBe(true);
  expect(batch.update(firstLayer, at({ state: "focus", landed: 0, reducedMotion: true }))).toBe(
    false,
  );
  expect(damageAppearance(at({ reducedMotion: true }), born).energy).toBe(
    damageAppearance(at({ reducedMotion: true, seconds: born + 100 }), born).energy,
  );
  expect(damageLayer(meshes, instance, targets, []).damage!.born).toBe(born);
  batch.dispose();
  expect(batch.group.children).toHaveLength(0);
});

it("line marks retain dashed geometry and selection depth behavior", () => {
  const alarm = new THREE.Color(0.3, 0.1, 0.05);
  const lines = markLines(
    [
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
    ],
    alarm,
    { dash: { size: 2, gap: 3 } },
  );
  expect(lines.children.map((c) => (c as LineSegments2).material.dashed)).toEqual([
    false,
    true,
    true,
  ]);
  for (const extra of [
    {},
    { state: "reach" },
    { state: "hover" },
    { state: "focus" },
    { selected: true },
    { lit: true },
    {},
  ] as Partial<LayerFrame>[]) {
    markFrame(lines, {
      seconds: 3,
      reducedMotion: true,
      state: "rest",
      landed: Infinity,
      ...extra,
    });
    const lit = !!extra.selected || !!extra.lit || extra.state === "hover" || extra.state === "focus";
    for (const child of lines.children as THREE.Mesh[])
      expect((child.material as THREE.Material).depthTest).toBe(true);
    // The occluded twin shows only while lit, at the shared occluded alpha.
    const behind = lines.children[2] as LineSegments2;
    expect(behind.material.depthFunc).toBe(THREE.GreaterDepth);
    expect(behind.material.opacity).toBe(lit ? 0.35 : 0);
  }
});

it.each([WHITE, BLACK])("shared ground colours cannot be corrupted by a material", (color) => {
  const before = color.clone();
  expect(() => color.copy(new THREE.Color())).toThrow(TypeError);
  const material = new THREE.MeshLambertMaterial({ ...GROUND_MATERIAL, color });
  material.color.lerp(before, 0.5);
  expect(material.color).not.toBe(color);
  expect(color.equals(before)).toBe(true);
  material.dispose();
});

it("grounds retain captured tiers and translucent defaults, with scale-invariant fog", () => {
  const context = paintOf({ ...instance, focus: false });
  expect([context.tier, paintOf(instance).tier]).toEqual(["context", "subject"]);
  expect(paintOf(instance, () => ({ tier: "stub", key: "SA 7" }))).toEqual({
    tier: "stub",
    key: "SA 7",
  });
  expect(paintOf(instance, () => undefined)).toEqual({ tier: "subject" });
  expect(GROUND_MATERIAL).toMatchObject({ depthTest: true, depthWrite: false });
});

it("row damage feeds both plan marks and native mesh skins, then clears with the row", () => {
  const row = { key: "flow:7", ids: [7], damage: "no airflow", findings: ["no-flow:7"] };
  expect(damageMark(row)).toEqual({ "data-damage": "no airflow" });
  const layers = damageLayers(meshes, [row]);
  expect(layers).toHaveLength(1);
  expect(layers[0]!.targets).toEqual([{ key: row.key, elementId: 7 }]);
  expect(layers[0]!.findings).toEqual(row.findings);
  expect(damageMark({ ...row, damage: null })["data-damage"]).toBeUndefined();
  expect(damageLayers(meshes, [{ ...row, damage: null }])).toEqual([]);
  expect(damageLayers(meshes, [{ ...row, ids: [8] }])).toEqual([]);
});
