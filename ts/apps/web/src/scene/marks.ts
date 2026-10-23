/**
 * The stage's issue marks: lines with a pixel width and a dark casing (they read over any duct or
 * background at any zoom), translucent volumes, and one state ladder every mark answers the same
 * way. The renderer owns the state (`LayerFrame`); a mark only maps it to uniforms.
 *
 * Widths are CSS px (`LineMaterial.resolution` is the canvas size, set by the renderer).
 */
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { IssueState, LayerFrame } from "./types";

type Edge = readonly [readonly number[], readonly number[]];

/** Ink width per rung; the casing is wider by `CASING` px on each side. */
const WIDTH: Record<IssueState, number> = { rest: 1.75, reach: 2.75, hover: 3.5, focus: 4 };
/** How far each rung lifts the ink toward white: brighter, never another hue. */
const LIFT: Record<IssueState, number> = { rest: 0, reach: 0.18, hover: 0.38, focus: 0.3 };
const CASING_ALPHA: Record<IssueState, number> = {
  rest: 0.35,
  reach: 0.5,
  hover: 0.7,
  focus: 0.75,
};
const VOLUME_ALPHA: Record<IssueState, number> = {
  rest: 0.28,
  reach: 0.4,
  hover: 0.55,
  focus: 0.6,
};
const CASING = 1.5;
/** The landing swell when an issue becomes the focus, in seconds; every landing on the stage
 * (an issue focused, a subject reached by an alias jump) runs this long. */
const LAND = 0.65;
const WHITE = new THREE.Color(1, 1, 1);

/** 1 at the moment of landing, easing out to 0 over `LAND`. */
export const landing = (landed: number) => (landed < LAND ? (1 - landed / LAND) ** 3 : 0);

/** One finding's lines over the meshes (never hidden inside a duct). Dash sizes are feet; `weight`
 * scales every rung's width (a centreline reads heavier than a face outline). */
export function markLines(
  edges: readonly Edge[],
  color: THREE.Color,
  { dash, weight = 1 }: { dash?: { size: number; gap: number }; weight?: number } = {},
): THREE.Group {
  const geometry = new LineSegmentsGeometry().setPositions(edges.flatMap(([p, q]) => [...p, ...q]));
  const casing = new LineSegments2(
    geometry,
    new LineMaterial({
      color: 0x000000,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  casing.userData.casing = true;
  casing.renderOrder = 9;
  const ink = new LineSegments2(
    geometry,
    new LineMaterial({
      color,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      dashed: !!dash,
      dashSize: dash?.size ?? 1,
      gapSize: dash?.gap ?? 1,
    }),
  );
  if (dash) ink.computeLineDistances();
  ink.userData.rest = color.clone();
  ink.renderOrder = 10;
  const group = new THREE.Group();
  group.add(casing, ink);
  group.userData.weight = weight;
  markFrame(group, { seconds: 0, reducedMotion: true, state: "rest", landed: Infinity });
  return group;
}

/** A translucent volume (what a heal adds) with its edges as a line mark. */
export function markVolume(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.Group {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 9;
  const position = new THREE.EdgesGeometry(geometry, 30).getAttribute("position");
  const edges: Edge[] = [];
  for (let i = 0; i < position.count; i += 2)
    edges.push([
      [position.getX(i), position.getY(i), position.getZ(i)],
      [position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)],
    ]);
  const group = new THREE.Group();
  group.add(mesh, markLines(edges, color));
  return group;
}

/** Every mark's answer to its state; true while the landing swell still moves. */
export function markFrame(group: THREE.Object3D, at: LayerFrame): boolean {
  const swell = at.reducedMotion ? 0 : landing(at.landed);
  group.traverse((object) => {
    if (object instanceof LineSegments2) {
      const material = object.material as LineMaterial;
      const width = WIDTH[at.state] * (object.parent?.userData.weight ?? 1) + swell * 5;
      if (object.userData.casing) {
        material.linewidth = width + CASING * 2;
        material.opacity = CASING_ALPHA[at.state];
      } else {
        material.linewidth = width;
        material.color.copy(object.userData.rest).lerp(WHITE, LIFT[at.state] + swell * 0.4);
      }
    } else if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial)
      object.material.opacity = VOLUME_ALPHA[at.state] + swell * 0.3;
  });
  return swell > 0;
}
