import { expect, it } from "vite-plus/test";
import { CONTEXT_OPACITY_LIMIT, LOOK } from "./grounds";
import { SceneMeshes, type SceneInstance } from "./types";
import { bakeVeil, falloff, setVeilLook, veilDistance, veilUniforms, VEIL_REACH_FT } from "./veil";

it("context fill cannot become opaque when the fill is set past the limit", () => {
  const u = veilUniforms();
  setVeilLook(u, { ...LOOK.defaults.veil, fill: 1 });
  expect(u.veilFill.value).toBe(CONTEXT_OPACITY_LIMIT);
  expect(Math.fround(u.veilFill.value)).toBeLessThan(1);
  u.veilField.value.dispose();
});

it("falls steeply from near to far, clamps outside, and stays finite at a crossed range", () => {
  for (const [d, expected] of [
    [-1, 1],
    [1, 1],
    [4, 4 / 9],
    [7, 1 / 9],
    [10, 0],
    [20, 0],
  ])
    expect(falloff(d!, 1, 10, 2)).toBeCloseTo(expected!);
  expect(falloff(4, 1, 10, 4)).toBeLessThan(falloff(4, 1, 10, 2));
  expect(falloff(1, 1, 1, 2)).toBe(1);
  expect(falloff(2, 1, 0, 2)).toBe(0);
});

const instance: SceneInstance = {
  key: "triangle",
  revitId: 1,
  documentKey: "fixture",
  linkInstanceId: null,
  uniqueId: "triangle",
  category: "Ducts",
  categoryId: null,
  focus: true,
  firstVertex: 0,
  vertexCount: 3,
};

it("bakes distance to triangle interiors, excludes context, and bounds a flat field", () => {
  const bounds = { minX: 100, minY: 100, minZ: 0, maxX: 120, maxY: 120, maxZ: 8 };
  const meshes = new SceneMeshes(
    new Float32Array([100, 100, 0, 120, 100, 0, 100, 120, 0]),
    bounds,
    [instance],
  );
  const field = bakeVeil(meshes, () => true);
  const at = (x: number, y: number, z: number) =>
    (field.data[
      Math.floor(x / field.cellFt) +
        field.dims[0] *
          (Math.floor(y / field.cellFt) + field.dims[1] * Math.floor(z / field.cellFt))
    ]! *
      (VEIL_REACH_FT + field.cellFt)) /
    255;
  // The middle of a broad face is near even though it is far from all three vertices.
  expect(at(5, 5, 0)).toBe(0);
  expect(at(5, 5, 5)).toBeCloseTo(5, 0);
  expect(at(18, 18, 0)).toBeGreaterThan(10);
  expect(veilDistance(field, [105, 105, 0])).toBe(0);
  expect(veilDistance(field, [105, 105, 5])).toBeCloseTo(4.25, 0);
  expect(bakeVeil(meshes, () => false).data.every((d) => d === 255)).toBe(true);
  const flat = bakeVeil(
    new SceneMeshes(meshes.positions, { ...bounds, maxX: 100_100, maxZ: 0 }, [instance]),
    () => false,
  );
  expect(Math.max(...flat.dims)).toBeLessThanOrEqual(256);
  expect(flat.data.length).toBeLessThanOrEqual(2 ** 21);
  expect((flat.data[0]! / 255) * (VEIL_REACH_FT + flat.cellFt) - flat.cellFt).toBeCloseTo(
    VEIL_REACH_FT,
  );
});

it("samples a linear texture at cell centres and clamps at its boundaries", () => {
  const field = {
    data: new Uint8Array([0, 255]),
    dims: [2, 1, 1] as const,
    min: [0, 0, 0] as const,
    cellFt: 1,
  };
  expect(veilDistance(field, [0.5, 0, 0])).toBe(0);
  expect(veilDistance(field, [1, 0, 0])).toBe(31.5);
  expect(veilDistance(field, [100, 0, 0])).toBe(VEIL_REACH_FT);
});

it("starts with the glass compare off: a zero depth size never discards", () => {
  const u = veilUniforms();
  expect(u.contextDepthSize.value.toArray()).toEqual([0, 0]);
  expect(u.contextDepth.value).toBeNull();
});
