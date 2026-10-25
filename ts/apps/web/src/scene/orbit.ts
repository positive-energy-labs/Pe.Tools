/**
 * The orbit viewport (a Page key) and the three camera it stands for. World is host feet, z up.
 * yaw: degrees about world z of the camera's bearing from the pivot, 0 = from +X (east), 90 = from
 * +Y (north). elev: degrees above the horizon, 90 = plan. zoom: 1 = the scene bounds fill the view.
 */
import type { Bounds, SceneInstance, SceneMeshes } from "./types";
import { Quaternion, Vector3, type Camera } from "three";
import { LOOK } from "./grounds";

import { orbitLooks, type OrbitLook, type OrbitViewport } from "@pe/agent-contracts";
export type { OrbitLook, OrbitViewport };

type Vec3 = [number, number, number];
type XYZ = { x: number; y: number; z: number };

/** OrbitControls turns about its look target. Translate that turn to the selected pivot, keeping
 * the same camera orientation. Merely changing the pivot never calls this or moves the picture. */
export function rotateAbout(
  camera: Camera,
  target: Vector3,
  pivot: readonly number[],
  before: Quaternion,
) {
  const rotation = camera.quaternion.clone().multiply(before.clone().invert());
  const offset = new Vector3().fromArray(pivot).sub(target);
  const shift = offset.clone().sub(offset.applyQuaternion(rotation));
  camera.position.add(shift);
  target.add(shift);
  camera.updateMatrixWorld();
}

/** Vertical field of view of the one perspective camera, in degrees. */
export const ORBIT_FOV = 45;
const RAD = Math.PI / 180;
export const HALF_FOV_TAN = Math.tan((ORBIT_FOV / 2) * RAD);
// three's lookAt with z up degenerates looking straight down; plan stops just short and reads back as 90.
const ELEV_LIMIT = 89.9;

export const center = (b: Bounds): Vec3 => [
  (b.minX + b.maxX) / 2,
  (b.minY + b.maxY) / 2,
  (b.minZ + b.maxZ) / 2,
];

export type CameraBounds = {
  center: Vec3;
  /** Perspective eye-to-subject-centre radius, or the parallel picture's longest full extent. */
  reach: number;
  pan: Bounds;
};

/** A subject's diagonal and box centre do not change when captured context gets larger. */
export function cameraBounds(
  subject: Bounds,
  zoomOutFactor: number,
  panMargin: number,
): CameraBounds {
  const size = Math.max(
    Math.hypot(
      subject.maxX - subject.minX,
      subject.maxY - subject.minY,
      subject.maxZ - subject.minZ,
    ),
    1e-3,
  );
  const margin = size * Math.max(0, panMargin);
  return {
    center: center(subject),
    reach: size * Math.max(1, zoomOutFactor),
    pan: {
      minX: subject.minX - margin,
      maxX: subject.maxX + margin,
      minY: subject.minY - margin,
      maxY: subject.maxY + margin,
      minZ: subject.minZ - margin,
      maxZ: subject.maxZ + margin,
    },
  };
}

/** Keep the bearing and clamp the orbit ray against the sphere around the subject, not the pivot. */
export function boundOrbit(
  v: OrbitViewport,
  scene: Bounds,
  limits: CameraBounds | null,
  aspect = 1,
): OrbitViewport {
  if (!limits) return v;
  const p = new Vector3(...v.pivot).clamp(
    new Vector3(limits.pan.minX, limits.pan.minY, limits.pan.minZ),
    new Vector3(limits.pan.maxX, limits.pan.maxY, limits.pan.maxZ),
  );
  const fit = fitDistance(scene);
  let distance: number;
  if (v.projection === "parallel") {
    distance = limits.reach / (2 * HALF_FOV_TAN * Math.max(1, aspect));
  } else {
    const c = new Vector3(...limits.center);
    const q = p.clone().sub(c);
    // A pivot outside the eye's sphere can have no positive orbit-ray intersection.
    const inside = limits.reach * (1 - 1e-9);
    if (q.lengthSq() > inside * inside) p.copy(c).add(q.setLength(inside));
    const pose = toCamera({ ...v, zoom: 1, pivot: [0, 0, 0] }, scene);
    const direction = new Vector3(...pose.position).normalize();
    const along = q.dot(direction);
    distance = -along + Math.sqrt(Math.max(0, along * along + limits.reach ** 2 - q.lengthSq()));
  }
  const pivot = p.toArray() as Vec3;
  const zoom = Math.max(v.zoom, fit / Math.max(distance, 1e-9));
  return zoom === v.zoom && pivot.every((n, i) => n === v.pivot[i]) ? v : { ...v, zoom, pivot };
}

/** Start a new subject's return at the current view; shrink these limits smoothly to its own. */
export function boundsIncludingView(
  limits: CameraBounds,
  v: OrbitViewport,
  scene: Bounds,
  aspect: number,
): CameraBounds {
  const pose = toCamera(v, scene);
  const reach =
    v.projection === "parallel"
      ? (2 * fitDistance(scene) * HALF_FOV_TAN * Math.max(1, aspect)) / v.zoom
      : Math.max(
          new Vector3(...pose.position).distanceTo(new Vector3(...limits.center)),
          new Vector3(...v.pivot).distanceTo(new Vector3(...limits.center)) / (1 - 1e-9) + 1e-6,
        );
  return {
    ...limits,
    reach: Math.max(limits.reach, reach),
    pan: {
      minX: Math.min(limits.pan.minX, v.pivot[0]),
      maxX: Math.max(limits.pan.maxX, v.pivot[0]),
      minY: Math.min(limits.pan.minY, v.pivot[1]),
      maxY: Math.max(limits.pan.maxY, v.pivot[1]),
      minZ: Math.min(limits.pan.minZ, v.pivot[2]),
      maxZ: Math.max(limits.pan.maxZ, v.pivot[2]),
    },
  };
}

export function mixCameraBounds(from: CameraBounds, to: CameraBounds, t: number): CameraBounds {
  if (t === 1) return to;
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    center: to.center,
    reach: mix(from.reach, to.reach),
    pan: Object.fromEntries(
      Object.entries(to.pan).map(([key, value]) => [
        key,
        mix(from.pan[key as keyof Bounds], value),
      ]),
    ) as Bounds,
  };
}

/** A busy frame delays the return instead of skipping the travel that locates the new subject. */
export function cameraReturnProgress(
  clock: { elapsed: number; last: number | null },
  at: number,
  duration: number,
): number {
  clock.elapsed += clock.last === null ? 0 : Math.min(Math.max(0, at - clock.last), 34);
  clock.last = at;
  return Math.min(1, clock.elapsed / duration);
}

/** Fit the bounds' sphere inside the smaller field of view, including portrait panes. */
export function fitDistance(b: Bounds, aspect = 1) {
  const radius = Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2, 0.5);
  const half = Math.atan(HALF_FOV_TAN * Math.min(1, Math.max(aspect, 0.001)));
  return radius / Math.sin(half);
}

export function toCamera(v: OrbitViewport, bounds: Bounds): { position: Vec3; target: Vec3 } {
  const elev = Math.min(Math.max(v.elev, -ELEV_LIMIT), ELEV_LIMIT) * RAD,
    yaw = v.yaw * RAD,
    d = fitDistance(bounds) / v.zoom,
    [x, y, z] = v.pivot;
  return {
    target: [x, y, z],
    position: [
      x + d * Math.cos(elev) * Math.cos(yaw),
      y + d * Math.cos(elev) * Math.sin(yaw),
      z + d * Math.sin(elev),
    ],
  };
}

/** Read the viewport back from OrbitControls (or anything shaped like it), in world coordinates. */
export function fromControls(
  controls: {
    object: { position: XYZ; zoom?: number; isOrthographicCamera?: boolean };
    target: XYZ;
  },
  bounds: Bounds,
): OrbitViewport {
  const { target: t } = controls,
    p = controls.object.position;
  const dx = p.x - t.x,
    dy = p.y - t.y,
    dz = p.z - t.z,
    d = Math.hypot(dx, dy, dz) || 1e-9;
  const elev = Math.asin(Math.min(Math.max(dz / d, -1), 1)) / RAD;
  return {
    kind: "orbit",
    projection: controls.object.isOrthographicCamera ? "parallel" : "perspective",
    yaw: Math.atan2(dy, dx) / RAD,
    elev: Math.abs(elev) >= ELEV_LIMIT - 1e-6 ? Math.sign(elev) * 90 : elev,
    zoom:
      (fitDistance(bounds) / d) *
      (controls.object.isOrthographicCamera ? (controls.object.zoom ?? 1) : 1),
    pivot: [t.x, t.y, t.z],
  };
}

/** A named look over the pose the picture shows: pivot and zoom kept, a look without a yaw keeps it. */
export const applyLook = (look: OrbitLook, pose: OrbitViewport): OrbitViewport => {
  const turn: { yaw?: number; elev: number } = orbitLooks[look];
  return { ...pose, yaw: turn.yaw ?? pose.yaw, elev: turn.elev };
};

/**
 * `target` filling the view, seen from `from`. Zoom is measured against `scene`, the bounds the
 * camera is built on (`toCamera`), so a frame of a few elements inside a larger capture is close.
 */
export function frame(
  scene: Bounds,
  target: Bounds = scene,
  from: Pick<OrbitViewport, "yaw" | "elev" | "projection"> = {
    yaw: LOOK.read().camera.yaw,
    elev: LOOK.read().camera.elev,
    projection: "parallel",
  },
  aspect = 1,
  points?: Iterable<readonly number[]>,
): OrbitViewport {
  const yaw = from.yaw * RAD;
  const elev = Math.min(ELEV_LIMIT, Math.max(-ELEV_LIMIT, from.elev)) * RAD;
  let pivot = center(target);
  const right = [-Math.sin(yaw), Math.cos(yaw), 0];
  const up = [-Math.sin(elev) * Math.cos(yaw), -Math.sin(elev) * Math.sin(yaw), Math.cos(elev)];
  const eye = [Math.cos(elev) * Math.cos(yaw), Math.cos(elev) * Math.sin(yaw), Math.sin(elev)];
  const vertices =
    points ??
    [target.minX, target.maxX].flatMap((x) =>
      [target.minY, target.maxY].flatMap((y) => [target.minZ, target.maxZ].map((z) => [x, y, z])),
    );
  let distance = 0.5;
  const extents = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const p of vertices) {
    const q = p.map((n, i) => n - pivot[i]!);
    const dot = (v: number[]) => q.reduce((sum, n, i) => sum + n * v[i]!, 0);
    const x = dot(right),
      y = dot(up);
    extents.x0 = Math.min(extents.x0, x);
    extents.x1 = Math.max(extents.x1, x);
    extents.y0 = Math.min(extents.y0, y);
    extents.y1 = Math.max(extents.y1, y);
    const extent = Math.max(Math.abs(dot(right)) / Math.max(aspect, 0.001), Math.abs(dot(up)));
    distance = Math.max(
      distance,
      extent / (HALF_FOV_TAN * LOOK.read().camera.frameFill) +
        (from.projection === "parallel" ? 0 : dot(eye)),
    );
  }
  if (from.projection === "parallel" && Number.isFinite(extents.x0)) {
    distance =
      Math.max((extents.x1 - extents.x0) / Math.max(aspect, 0.001), extents.y1 - extents.y0, 1) /
      (2 * HALF_FOV_TAN * LOOK.read().camera.frameFill);
    pivot = pivot.map(
      (n, i) =>
        n + (right[i]! * (extents.x0 + extents.x1)) / 2 + (up[i]! * (extents.y0 + extents.y1)) / 2,
    ) as Vec3;
  }
  return {
    kind: "orbit",
    projection: from.projection,
    yaw: from.yaw,
    elev: from.elev,
    zoom: fitDistance(scene) / distance,
    pivot,
  };
}

/**
 * The same view slid in its own screen plane so whatever sat at the centre sits `dx` px right and
 * `dy` px down of it on a picture `heightPx` tall: orientation and zoom kept, only the target moves.
 */
export function shiftOnScreen(
  v: OrbitViewport,
  scene: Bounds,
  heightPx: number,
  dx: number,
  dy: number,
): OrbitViewport {
  const feetPerPx = (2 * (fitDistance(scene) / v.zoom) * HALF_FOV_TAN) / heightPx;
  const yaw = v.yaw * RAD,
    elev = Math.min(Math.max(v.elev, -ELEV_LIMIT), ELEV_LIMIT) * RAD;
  const right = [-Math.sin(yaw), Math.cos(yaw), 0];
  const up = [-Math.sin(elev) * Math.cos(yaw), -Math.sin(elev) * Math.sin(yaw), Math.cos(elev)];
  return {
    ...v,
    pivot: v.pivot.map(
      (p, i) => p + (-right[i]! * dx + up[i]! * dy) * feetPerPx,
    ) as OrbitViewport["pivot"],
  };
}

/** The box around world points; null for none. */
export function boundsOfPoints(points: Iterable<readonly number[]>): Bounds | null {
  const b = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const [x = 0, y = 0, z = 0] of points) {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.minZ = Math.min(b.minZ, z);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return Number.isFinite(b.minX) ? b : null;
}

/** The box around the instances `keep` admits, from their vertices; null for none. */
export function boundsOfInstances(
  meshes: SceneMeshes,
  keep: (instance: SceneInstance) => boolean,
): Bounds | null {
  const b = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  const p = meshes.positions;
  for (const instance of meshes.instances) {
    if (!keep(instance)) continue;
    const end = (instance.firstVertex + instance.vertexCount) * 3;
    for (let i = instance.firstVertex * 3; i < end; i += 3) {
      b.minX = Math.min(b.minX, p[i]!);
      b.minY = Math.min(b.minY, p[i + 1]!);
      b.minZ = Math.min(b.minZ, p[i + 2]!);
      b.maxX = Math.max(b.maxX, p[i]!);
      b.maxY = Math.max(b.maxY, p[i + 1]!);
      b.maxZ = Math.max(b.maxZ, p[i + 2]!);
    }
  }
  return Number.isFinite(b.minX) ? b : null;
}
