import { describe, expect, it } from "vite-plus/test";
import {
  fit,
  fitDistance,
  fromControls,
  presets,
  samePose,
  toCamera,
  type OrbitViewport,
} from "./orbit";

const bounds = { minX: 100, minY: 200, minZ: 0, maxX: 140, maxY: 230, maxZ: 12 };
const controlsOf = (pose: ReturnType<typeof toCamera>) => {
  const xyz = ([x, y, z]: number[]) => ({ x: x!, y: y!, z: z! });
  return { object: { position: xyz(pose.position) }, target: xyz(pose.target) };
};
const roundTrip = (v: OrbitViewport) => fromControls(controlsOf(toCamera(v, bounds)), bounds);
const expectPose = (a: OrbitViewport, b: OrbitViewport) => {
  expect(a.kind).toBe("orbit");
  expect(a.yaw).toBeCloseTo(b.yaw, 6);
  expect(a.elev).toBeCloseTo(b.elev, 6);
  expect(a.zoom).toBeCloseTo(b.zoom, 6);
  a.pivot.forEach((x, i) => expect(x).toBeCloseTo(b.pivot[i]!, 6));
};

describe("orbit viewport ↔ camera", () => {
  it("round trips through the camera pose", () => {
    for (const v of [
      { kind: "orbit", yaw: -45, elev: 35, zoom: 1, pivot: [120, 215, 6] },
      { kind: "orbit", yaw: 170, elev: -20, zoom: 3.5, pivot: [0, 0, 0] },
      { kind: "orbit", yaw: 90, elev: 0, zoom: 0.25, pivot: [101, 201, 1] },
    ] satisfies OrbitViewport[])
      expectPose(roundTrip(v), v);
  });
  it("places the camera on its bearing: yaw 0 from +X, 90 from +Y, elev 90 above", () => {
    const at = (yaw: number, elev: number) => {
      const { position, target } = toCamera(
        { kind: "orbit", yaw, elev, zoom: 1, pivot: [0, 0, 0] },
        bounds,
      );
      return position.map((p, i) => Math.sign(Math.round(p - target[i]!)) + 0); // +0 folds -0
    };
    expect(at(0, 0)).toEqual([1, 0, 0]);
    expect(at(90, 0)).toEqual([0, 1, 0]);
    expect(at(-90, 90)).toEqual([0, 0, 1]);
  });
  it("zoom 1 is the fit distance; zoom 2 halves it", () => {
    const d = (zoom: number) => {
      const { position, target } = toCamera({ ...fit(bounds), zoom }, bounds);
      return Math.hypot(...position.map((p, i) => p - target[i]!));
    };
    expect(d(1)).toBeCloseTo(fitDistance(bounds), 6);
    expect(d(2)).toBeCloseTo(fitDistance(bounds) / 2, 6);
  });
});

describe("fit and presets", () => {
  it("fit centres the pivot at zoom 1 and keeps the direction it is given", () => {
    const v = fit(bounds, { yaw: 30, elev: 10 });
    expect(v).toEqual({ kind: "orbit", yaw: 30, elev: 10, zoom: 1, pivot: [120, 215, 6] });
    expect(fit(bounds).yaw).toBe(-45);
    expect(fit(bounds).elev).toBeCloseTo(35.264, 3);
  });
  it("the three axes look down, south and west, and plan survives the camera", () => {
    expect(presets.top(bounds)).toMatchObject({ yaw: -90, elev: 90, zoom: 1 });
    expect(presets.north(bounds)).toMatchObject({ yaw: 90, elev: 0 });
    expect(presets.east(bounds)).toMatchObject({ yaw: 0, elev: 0 });
    for (const preset of Object.values(presets))
      expectPose(roundTrip(preset(bounds)), preset(bounds));
  });
  it("a decoded echo is the same pose; a real move is not", () => {
    const v = fit(bounds);
    expect(samePose(v, { ...v, yaw: v.yaw + 360.01 }, bounds)).toBe(true);
    expect(samePose(v, { ...v, zoom: 1.0001 }, bounds)).toBe(true);
    expect(samePose(v, { ...v, yaw: v.yaw + 1 }, bounds)).toBe(false);
    expect(samePose(v, { ...v, pivot: [121, 215, 6] }, bounds)).toBe(false);
  });
});
