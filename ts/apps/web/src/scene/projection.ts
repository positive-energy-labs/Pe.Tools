/**
 * World feet to screen px, for DOM drawn over a `Scene3D` (labels, marks, halos). The renderer's
 * camera and an overlay without one are built by `newCamera`, so the two never disagree.
 */
import * as THREE from "three";
import { ORBIT_FOV, toCamera, type OrbitViewport } from "./orbit";
import type { Bounds } from "./types";

export type Size = { width: number; height: number };
/** A world point to px from the canvas's top-left; null behind the camera. */
export type Project = (point: readonly number[]) => [number, number] | null;

export type OrbitCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export function newCamera(
  aspect = 1,
  projection: OrbitViewport["projection"] = "perspective",
): OrbitCamera {
  const camera =
    projection === "parallel"
      ? new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.05, 100000)
      : new THREE.PerspectiveCamera(ORBIT_FOV, aspect, 0.05, 100000);
  camera.up.set(0, 0, 1);
  return camera;
}

export function resizeCamera(camera: OrbitCamera, aspect: number) {
  if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
  else {
    camera.left = -camera.top * aspect;
    camera.right = camera.top * aspect;
  }
  camera.updateProjectionMatrix();
}

/** Parallel framing matches the perspective picture at its look-at plane. */
export function placeCamera(
  camera: OrbitCamera,
  viewport: OrbitViewport,
  bounds: Bounds,
  aspect: number,
) {
  const pose = toCamera(viewport, bounds);
  camera.position.fromArray(pose.position);
  camera.lookAt(...pose.target);
  if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = 1;
    camera.top =
      camera.position.distanceTo(new THREE.Vector3(...pose.target)) *
      Math.tan(THREE.MathUtils.degToRad(ORBIT_FOV / 2));
    camera.bottom = -camera.top;
  }
  resizeCamera(camera, aspect);
}

export const viewHeight = (camera: OrbitCamera, target: THREE.Vector3) =>
  camera instanceof THREE.OrthographicCamera
    ? (camera.top - camera.bottom) / camera.zoom
    : 2 * camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(ORBIT_FOV / 2));

/** The camera as it is now, frozen into a projection over a canvas of `size`. */
export function projectThrough(camera: THREE.Camera, size: Size): Project {
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse.clone();
  const lens = camera.projectionMatrix.clone();
  const v = new THREE.Vector3();
  return (p) => {
    v.set(p[0]!, p[1]!, p[2]!).applyMatrix4(view);
    if (v.z >= 0) return null;
    v.applyMatrix4(lens);
    return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
  };
}

/** Canvas px to the world ray under them: an origin on the near plane and a unit direction. */
export type Ray = (x: number, y: number) => { origin: number[]; direction: number[] };

/** The camera as it is now, frozen into the inverse of `projectThrough`. */
export function rayThrough(camera: THREE.Camera, size: Size): Ray {
  camera.updateMatrixWorld();
  const frozen = camera.clone();
  return (x, y) => {
    const ndc = new THREE.Vector2((x / size.width) * 2 - 1, 1 - (y / size.height) * 2);
    const near = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(frozen);
    const far = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(frozen);
    return { origin: near.toArray(), direction: far.sub(near).normalize().toArray() };
  };
}

/** The projection a `Scene3D` over `bounds` draws `viewport` with, with no renderer at all. */
export function viewportProject(viewport: OrbitViewport, bounds: Bounds, size: Size): Project {
  const camera = newCamera(size.width / size.height, viewport.projection);
  placeCamera(camera, viewport, bounds, size.width / size.height);
  return projectThrough(camera, size);
}
