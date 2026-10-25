import * as THREE from "three";
import type { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { expect, it } from "vite-plus/test";
import { damageLayers, damageMark, damageLayer, heartbeat, setDamageHue } from "./damage";
import { landing, markFrame, markLines } from "./marks";
import { BLACK, WHITE, fogDensity, paintOf, GROUND_MATERIAL, keySlot, LOOK } from "./grounds";
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

it("damage keeps mesh and row identity, beats, flashes once, and holds still for reduced motion", () => {
  const targets = [{ key: "equipmentFlows:7", elementId: 7 }];
  const alarm = new THREE.Color(0.3, 0.1, 0.05);
  setDamageHue(alarm);
  const layer = damageLayer(meshes, instance, targets, ["no-flow:7"]);
  const group = new THREE.Group();
  layer.build(group);
  for (const child of group.children as THREE.Mesh[])
    expect(child.material).toMatchObject({
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
  const p = [0, 0, 0],
    q = [1, 1, 1];
  const lines = markLines([[p, q]], alarm, { dash: { size: 2, gap: 3 } });
  expect(lines.children.map((c) => (c as LineSegments2).material.dashed)).toEqual([false, true]);
  const born = performance.now() / 1000;
  expect(layer.targets).toEqual(targets);
  expect(group.position.toArray()).toEqual([101, 101, 0]);
  const skin = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
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
  for (const extra of [
    {},
    { state: "reach" },
    { state: "hover" },
    { state: "focus" },
    { selected: true },
    { lit: true },
    {},
  ] as Partial<LayerFrame>[]) {
    layer.frame!(group, at(born + 6, extra));
    markFrame(lines, at(born + 6, extra));
    for (const child of [...group.children, ...lines.children] as THREE.Mesh[])
      expect((child.material as THREE.Material).depthTest).toBe(
        !extra.selected && !extra.lit && extra.state !== "hover" && extra.state !== "focus",
      );
  }
  const look = {
    ...LOOK.defaults,
    damage: { ...LOOK.defaults.damage, alpha: 0.2 },
    marks: { ...LOOK.defaults.marks, restCasing: 0.12 },
  };
  layer.frame!(group, at(born + 6, { reducedMotion: true, look }));
  markFrame(lines, at(born + 6, { reducedMotion: true, look }));
  expect(skin.material.uniforms.alpha!.value).toBe(0.2);
  expect((lines.children[0] as LineSegments2).material.opacity).toBe(0.12);
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
  expect(keySlot("SA 7", 6)).toBe(keySlot("SA 7", 6));
  expect(keySlot("SA 7", 6)).toBeGreaterThanOrEqual(0);
  expect(keySlot("SA 7", 6)).toBeLessThan(6);
  expect(GROUND_MATERIAL).toMatchObject({ depthTest: true, depthWrite: false });
  const b = { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 4, maxZ: 0 };
  const larger = { ...b, maxX: 30, maxY: 40 };
  expect(fogDensity(b)).toBeCloseTo(fogDensity(larger) * 10);
  expect(Number.isFinite(fogDensity({ ...b, maxX: 0, maxY: 0 }))).toBe(true);
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
