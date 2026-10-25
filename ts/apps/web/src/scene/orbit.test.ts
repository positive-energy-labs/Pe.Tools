import { describe, expect, it } from "vite-plus/test";
import { Quaternion, Vector3 } from "three";
import { newCamera, viewportProject } from "./projection";
import {
  shiftOnScreen,
  applyLook,
  boundsOfPoints,
  fitDistance,
  frame,
  fromControls,
  rotateAbout,
  toCamera,
  cameraBounds,
  boundOrbit,
  boundsIncludingView,
  mixCameraBounds,
  cameraReturnProgress,
  HALF_FOV_TAN,
  boundsOfInstances,
  type OrbitViewport,
} from "./orbit";
import { SceneMeshes } from "./types";
import { paintOf } from "./grounds";

const bounds = { minX: 100, minY: 200, minZ: 0, maxX: 140, maxY: 230, maxZ: 12 };

describe("subject camera bounds", () => {
  it("a stalled frame cannot skip the camera return", () => {
    const clock = { elapsed: 0, last: null as number | null };
    expect(cameraReturnProgress(clock, 650, 380)).toBe(0);
    expect(cameraReturnProgress(clock, 1650, 380)).toBeCloseTo(34 / 380);
    for (let at = 1666; at < 2100; at += 16) cameraReturnProgress(clock, at, 380);
    expect(cameraReturnProgress(clock, 2100, 380)).toBe(1);
  });
  const subject = { minX: -10, maxX: 10, minY: -2, maxY: 2, minZ: 0, maxZ: 2 };
  const scene = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000, minZ: -100, maxZ: 100 };
  const limits = cameraBounds(subject, 2, 0.25);
  const view: OrbitViewport = { kind: "orbit", yaw: 25, elev: 30, zoom: 0.01, pivot: [7, 3, 1] };

  it("clamps perspective distance from the subject centre, including an offset orbit target", () => {
    const v = boundOrbit(view, scene, limits);
    const eye = new Vector3(...toCamera(v, scene).position);
    expect(eye.distanceTo(new Vector3(...limits.center))).toBeCloseTo(limits.reach, 8);
    expect(v.pivot).toEqual(view.pivot);
    expect([v.yaw, v.elev]).toEqual([view.yaw, view.elev]);
    expect(boundOrbit({ ...v, zoom: v.zoom * 2 }, scene, limits).zoom).toBe(v.zoom * 2);
  });

  it("clamps the parallel picture's longest full extent in landscape and portrait", () => {
    for (const aspect of [0.4, 2.5]) {
      const v = boundOrbit({ ...view, projection: "parallel" }, scene, limits, aspect);
      const extent = (2 * fitDistance(scene) * HALF_FOV_TAN * Math.max(1, aspect)) / v.zoom;
      expect(extent).toBeCloseTo(limits.reach, 8);
      // Enlarging only the captured context cannot enlarge the allowed world extent.
      const small = boundOrbit({ ...view, projection: "parallel" }, subject, limits, aspect);
      expect(
        (2 * fitDistance(subject) * HALF_FOV_TAN * Math.max(1, aspect)) / small.zoom,
      ).toBeCloseTo(extent, 8);
    }
  });

  it("clamps panning to the subject plus the margin, including very large attempted pans", () => {
    const v = boundOrbit(
      { ...view, projection: "parallel", pivot: [-1e6, 1e6, 1e6] },
      scene,
      limits,
    );
    expect(v.pivot).toEqual([limits.pan.minX, limits.pan.maxY, limits.pan.maxZ]);
    const perspective = boundOrbit(
      { ...view, pivot: [1e6, -1e6, 1e6] },
      scene,
      cameraBounds(subject, 1, 1),
    );
    expect(
      new Vector3(...toCamera(perspective, scene).position).distanceTo(
        new Vector3(...limits.center),
      ),
    ).toBeLessThanOrEqual(limits.reach / 2 + 1e-7);
  });

  it("returns from an old view continuously when a smaller subject takes over", () => {
    const from = boundsIncludingView(limits, view, scene, 1);
    expect(boundOrbit(view, scene, from).zoom).toBeCloseTo(view.zoom, 12);
    const middle = boundOrbit(view, scene, mixCameraBounds(from, limits, 0.5));
    const end = boundOrbit(view, scene, limits);
    expect(middle.zoom).toBeGreaterThan(view.zoom);
    expect(middle.zoom).toBeLessThan(end.zoom);
    expect(mixCameraBounds(from, limits, 1)).toEqual(limits);
  });

  it("measures focus without paintOf, and includes painted stubs while excluding huge context", () => {
    const base = {
      revitId: 1,
      uniqueId: "fixture",
      documentKey: "fixture",
      linkInstanceId: null,
      category: "Ducts",
      categoryId: null,
      vertexCount: 3,
    };
    const meshes = new SceneMeshes(
      new Float32Array([
        0, 0, 0, 2, 0, 0, 0, 2, 0, 10, 0, 0, 12, 0, 0, 10, 2, 0, -1000, -1000, 0, 1000, 0, 0, 0,
        1000, 0,
      ]),
      scene,
      [
        { ...base, key: "subject", focus: true, firstVertex: 0 },
        { ...base, key: "stub", focus: false, firstVertex: 3 },
        { ...base, key: "context", focus: false, firstVertex: 6 },
      ],
    );
    expect(boundsOfInstances(meshes, (i) => paintOf(i).tier !== "context")?.maxX).toBe(2);
    const viewed = boundsOfInstances(
      meshes,
      (i) =>
        paintOf(i, (i) => ({ tier: i.key === "stub" ? "stub" : i.focus ? "subject" : "context" }))
          .tier !== "context",
    );
    expect(viewed).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 12, maxY: 2, maxZ: 0 });
  });
});
it("a system fit contains every corner in portrait and landscape navigation panes", () => {
  for (const size of [
    { width: 280, height: 845 },
    { width: 1400, height: 800 },
  ]) {
    const project = viewportProject(
      frame(bounds, bounds, undefined, size.width / size.height),
      bounds,
      size,
    );
    for (const x of [bounds.minX, bounds.maxX])
      for (const y of [bounds.minY, bounds.maxY])
        for (const z of [bounds.minZ, bounds.maxZ]) {
          const p = project([x, y, z])!;
          expect(p[0]).toBeGreaterThanOrEqual(0);
          expect(p[0]).toBeLessThanOrEqual(size.width);
          expect(p[1]).toBeGreaterThanOrEqual(0);
          expect(p[1]).toBeLessThanOrEqual(size.height);
        }
  }
});
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
    expect(frame(bounds, bounds, { yaw: 30, elev: 10 })).toMatchObject({
      kind: "orbit",
      yaw: 30,
      elev: 10,
      pivot: [120, 215, 6],
    });
    expect(frame(bounds).yaw).toBe(225);
    expect(frame(bounds).elev).toBe(32);
    const part = boundsOfPoints([
      [100, 200, 0],
      [110, 207.5, 3],
    ])!;
    expect(frame(bounds, part).zoom / frame(bounds).zoom).toBeCloseTo(4, 6);
  });
  it("a look keeps pivot and zoom; plan and iso keep the yaw, a cardinal sets it", () => {
    const shown: OrbitViewport = { kind: "orbit", yaw: 12, elev: 20, zoom: 3, pivot: [1, 2, 3] };
    expect(applyLook("plan", shown)).toEqual({ ...shown, elev: 90 });
    expect(applyLook("iso", shown).elev).toBeCloseTo(35.264, 3);
    expect(applyLook("north", shown)).toEqual({ ...shown, yaw: 90, elev: 0 });
    expectPose(roundTrip(applyLook("plan", shown)), { ...shown, elev: 90 });
  });
});

it("a view shifted on screen puts the old centre dx right and dy down, in the same orientation", () => {
  const scene = { minX: -50, maxX: 50, minY: -50, maxY: 50, minZ: 0, maxZ: 20 };
  const size = { width: 800, height: 600 };
  for (const [yaw, elev] of [
    [-45, 35],
    [120, 60],
    [10, 89],
  ] as const) {
    const v = {
      kind: "orbit" as const,
      yaw,
      elev,
      zoom: 3,
      pivot: [5, -7, 4] as [number, number, number],
    };
    const moved = shiftOnScreen(v, scene, size.height, 120, -80);
    expect([moved.yaw, moved.elev, moved.zoom]).toEqual([v.yaw, v.elev, v.zoom]);
    const at = viewportProject(moved, scene, size)(v.pivot)!;
    expect(at[0]).toBeCloseTo(400 + 120, 0);
    expect(at[1]).toBeCloseTo(300 - 80, 0);
  }
});
