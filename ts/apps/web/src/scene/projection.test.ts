import { describe, expect, it } from "vite-plus/test";
import { ORBIT_FOV, toCamera, type OrbitViewport } from "./orbit";
import { newCamera, placeCamera, projectThrough, rayThrough, viewportProject } from "./projection";
import { Vector3, OrthographicCamera } from "three";
import { fromControls } from "./orbit";
import { viewportCodec, orbitViewportSchema } from "@pe/agent-contracts";

const bounds = { minX: 100, minY: 200, minZ: 0, maxX: 140, maxY: 230, maxZ: 12 };
const size = { width: 900, height: 600 };
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V): V => a.map((x) => x / Math.hypot(...a)) as V;

/** A pinhole camera written out by hand from `toCamera`'s eye and target: the oracle. */
function pinhole(v: OrbitViewport, p: V): [number, number] {
  const { position, target } = toCamera(v, bounds);
  const forward = unit(sub(target as V, position as V));
  const right = unit(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const d = sub(p, position as V);
  const f = 1 / Math.tan((ORBIT_FOV / 2) * (Math.PI / 180));
  const depth = dot(d, forward);
  const aspect = size.width / size.height;
  const x = (f / aspect) * (dot(d, right) / depth);
  const y = f * (dot(d, up) / depth);
  return [((x + 1) / 2) * size.width, ((1 - y) / 2) * size.height];
}

describe("the overlay's projection", () => {
  it("parallel preserves framing at the look-at plane, and zoom restores through the address", () => {
    const perspective: OrbitViewport = {
      kind: "orbit",
      yaw: 0,
      elev: 0,
      zoom: 2,
      pivot: [120, 215, 6],
    };
    const parallel = { ...perspective, projection: "parallel" as const };
    const camera = newCamera(1.5, parallel.projection) as OrthographicCamera;
    placeCamera(camera, parallel, bounds, 1.5);
    const pinhole = viewportProject(perspective, bounds, size);
    const project = projectThrough(camera, size);
    for (const point of [
      [120, 215, 6],
      [120, 220, 12],
    ]) {
      project(point)!.forEach((n, i) => expect(n).toBeCloseTo(pinhole(point)![i]!, 7));
    }
    const ray = rayThrough(camera, size);
    expect(ray(0, 0).direction).toEqual(ray(900, 600).direction);
    camera.zoom = 1.5;
    const read = fromControls({ object: camera, target: new Vector3(...parallel.pivot) }, bounds);
    expect(read.zoom).toBeCloseTo(3);
    expect(read.projection).toBe("parallel");
    for (const projection of ["parallel", "perspective"] as const) {
      const pose = { ...read, zoom: 3, projection };
      expect(orbitViewportSchema.parse(viewportCodec.decode(viewportCodec.encode(pose)))).toEqual(
        pose,
      );
    }
    expect(viewportCodec.decode("orbit:fish:0,0,1@0,0,0")).toBeNull();
  });
  const points: V[] = [
    [120, 215, 6],
    [100, 200, 0],
    [140, 230, 12],
    [131.5, 204, 9.25],
  ];
  it.each<OrbitViewport>([
    { kind: "orbit", yaw: -45, elev: 35.264, zoom: 1, pivot: [120, 215, 6] },
    { kind: "orbit", yaw: 90, elev: 0, zoom: 2.5, pivot: [110, 220, 3] },
    { kind: "orbit", yaw: -90, elev: 89, zoom: 0.6, pivot: [125, 210, 0] },
  ])("lands within 0.5 px of the camera's own matrices at yaw $yaw elev $elev", (v) => {
    const project = viewportProject(v, bounds, size);
    for (const p of points) {
      const [x, y] = project(p)!;
      const [ox, oy] = pinhole(v, p);
      expect(Math.abs(x - ox)).toBeLessThan(0.5);
      expect(Math.abs(y - oy)).toBeLessThan(0.5);
    }
  });
  it("answers null behind the camera", () => {
    const v: OrbitViewport = { kind: "orbit", yaw: 0, elev: 0, zoom: 1, pivot: [120, 215, 6] };
    const eye = toCamera(v, bounds).position;
    expect(viewportProject(v, bounds, size)([eye[0] + 50, eye[1], eye[2]])).toBeNull();
  });
});
