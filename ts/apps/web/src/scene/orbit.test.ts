import { describe, expect, it } from "vite-plus/test";
import { Quaternion, Vector3 } from "three";
import { newCamera } from "./projection";
import {
  applyLook,
  boundsOfPoints,
  fitDistance,
  frame,
  fromControls,
  rotateAbout,
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

it("turns about an off-centre selection without recentering it or changing its distance", () => {
  const camera = newCamera(1.6);
  const target = new Vector3(0, 0, 0);
  camera.position.set(20, -30, 15);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const pivot = [8, 3, 2];
  const point = new Vector3().fromArray(pivot);
  const screen = point.clone().project(camera);
  const distance = camera.position.distanceTo(point);
  for (let i = 0; i < 5; i++) {
    const before = camera.quaternion.clone();
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.1);
    camera.position.sub(target).applyQuaternion(turn).add(target);
    camera.lookAt(target);
    rotateAbout(camera, target, pivot, before);
    const after = point.clone().project(camera);
    expect(after.x).toBeCloseTo(screen.x, 8);
    expect(after.y).toBeCloseTo(screen.y, 8);
    expect(camera.position.distanceTo(point)).toBeCloseTo(distance, 8);
  }
});

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
      const { position, target } = toCamera({ ...frame(bounds), zoom }, bounds);
      return Math.hypot(...position.map((p, i) => p - target[i]!));
    };
    expect(d(1)).toBeCloseTo(fitDistance(bounds), 6);
    expect(d(2)).toBeCloseTo(fitDistance(bounds) / 2, 6);
  });
});

describe("frame and looks", () => {
  it("frame centres the target, keeps the direction, and zooms against the scene's bounds", () => {
    expect(frame(bounds, bounds, { yaw: 30, elev: 10 })).toEqual({
      kind: "orbit",
      yaw: 30,
      elev: 10,
      zoom: 1,
      pivot: [120, 215, 6],
    });
    expect(frame(bounds).yaw).toBe(-45);
    expect(frame(bounds).elev).toBeCloseTo(35.264, 3);
    const part = boundsOfPoints([
      [100, 200, 0],
      [110, 207.5, 3],
    ])!;
    expect(frame(bounds, part).zoom).toBeCloseTo(4, 6);
  });
  it("a look keeps pivot and zoom; plan and iso keep the yaw, a cardinal sets it", () => {
    const shown: OrbitViewport = { kind: "orbit", yaw: 12, elev: 20, zoom: 3, pivot: [1, 2, 3] };
    expect(applyLook("plan", shown)).toEqual({ ...shown, elev: 90 });
    expect(applyLook("iso", shown).elev).toBeCloseTo(35.264, 3);
    expect(applyLook("north", shown)).toEqual({ ...shown, yaw: 90, elev: 0 });
    expectPose(roundTrip(applyLook("plan", shown)), { ...shown, elev: 90 });
  });
  it("a decoded echo is the same pose; a real move is not", () => {
    const v = frame(bounds);
    expect(samePose(v, { ...v, yaw: v.yaw + 360.01 }, bounds)).toBe(true);
    expect(samePose(v, { ...v, zoom: 1.0001 }, bounds)).toBe(true);
    expect(samePose(v, { ...v, yaw: v.yaw + 1 }, bounds)).toBe(false);
    expect(samePose(v, { ...v, pivot: [121, 215, 6] }, bounds)).toBe(false);
  });
});
