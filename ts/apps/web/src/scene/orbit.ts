/**
 * The orbit viewport (a Page key) and the three camera it stands for. World is host feet, z up.
 * yaw: degrees about world z of the camera's bearing from the pivot, 0 = from +X (east), 90 = from
 * +Y (north). elev: degrees above the horizon, 90 = plan. zoom: 1 = the scene bounds fill the view.
 */
import type { Bounds, SceneInstance, SceneMeshes } from "./types";

import { orbitLooks, type OrbitLook, type OrbitViewport } from "@pe/agent-contracts";
export type { OrbitLook, OrbitViewport };

type Vec3 = [number, number, number];
type XYZ = { x: number; y: number; z: number };

/** Vertical field of view of the one perspective camera, in degrees. */
export const ORBIT_FOV = 45;
const RAD = Math.PI / 180;
// three's lookAt with z up degenerates looking straight down; plan stops just short and reads back as 90.
const ELEV_LIMIT = 89.9;

export const center = (b: Bounds): Vec3 => [
  (b.minX + b.maxX) / 2,
  (b.minY + b.maxY) / 2,
  (b.minZ + b.maxZ) / 2,
];

/** Camera distance at zoom 1: the bounds' sphere fills the vertical field of view. */
export function fitDistance(b: Bounds) {
  const radius = Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2, 0.5);
  return radius / Math.sin((ORBIT_FOV / 2) * RAD);
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
  controls: { object: { position: XYZ }; target: XYZ },
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
    yaw: Math.atan2(dy, dx) / RAD,
    elev: Math.abs(elev) >= ELEV_LIMIT - 1e-6 ? Math.sign(elev) * 90 : elev,
    zoom: fitDistance(bounds) / d,
    pivot: [t.x, t.y, t.z],
  };
}

/** A named look over the pose the picture shows: pivot and zoom kept, a look without a yaw keeps it. */
export const applyLook = (look: OrbitLook, pose: OrbitViewport): OrbitViewport => {
  const turn: { yaw?: number; elev: number } = orbitLooks[look];
  return { ...pose, yaw: turn.yaw ?? pose.yaw, elev: turn.elev };
};

/** The direction a fit looks from when nothing else says: the iso from the south-east. */
const FIT_FROM = { yaw: -45, elev: orbitLooks.iso.elev };

/**
 * `target` filling the view, seen from `from`. Zoom is measured against `scene`, the bounds the
 * camera is built on (`toCamera`), so a frame of a few elements inside a larger capture is close.
 */
export function frame(
  scene: Bounds,
  target: Bounds = scene,
  from: Pick<OrbitViewport, "yaw" | "elev"> = FIT_FROM,
): OrbitViewport {
  return {
    kind: "orbit",
    yaw: from.yaw,
    elev: from.elev,
    zoom: fitDistance(scene) / fitDistance(target),
    pivot: center(target),
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

/** Same pose within what a page key keeps; a decoded echo of our own publish is not a move. */
export function samePose(a: OrbitViewport, b: OrbitViewport, bounds: Bounds) {
  const feet = fitDistance(bounds) * 1e-4;
  return (
    Math.abs(((a.yaw - b.yaw + 540) % 360) - 180) < 0.05 &&
    Math.abs(a.elev - b.elev) < 0.05 &&
    Math.abs(a.zoom / b.zoom - 1) < 1e-3 &&
    a.pivot.every((x, i) => Math.abs(x - b.pivot[i]!) < feet)
  );
}
