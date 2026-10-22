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

/** The one perspective camera: z up, the orbit's field of view. */
export function newCamera(aspect = 1) {
  const camera = new THREE.PerspectiveCamera(ORBIT_FOV, aspect, 0.05, 100000);
  camera.up.set(0, 0, 1);
  return camera;
}

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

/** The projection a `Scene3D` over `bounds` draws `viewport` with, with no renderer at all. */
export function viewportProject(viewport: OrbitViewport, bounds: Bounds, size: Size): Project {
  const camera = newCamera(size.width / size.height);
  const pose = toCamera(viewport, bounds);
  camera.position.fromArray(pose.position);
  camera.lookAt(...pose.target);
  return projectThrough(camera, size);
}
