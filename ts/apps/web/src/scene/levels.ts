import * as THREE from "three";
import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";
import type { Bounds, Layer3D } from "./types";
import type { Section } from "./section";

export type SceneLevels = RevitDetailSpaceScene.Artifact.SceneLevels;
export type LevelPlane = SceneLevels["planes"][number];
export const levelNames = (plane: LevelPlane) =>
  [...new Set(plane.members.map((m) => m.name))].join(" / ");

/** The datum perimeter follows the visible section; otherwise all four edges can lie outside it. */
export function levelPictureBounds(bounds: Bounds, section: Section | null): Bounds | null {
  const next = { ...bounds };
  for (const axis of ["X", "Y", "Z"] as const) {
    if (section?.kind === "box") {
      next[`min${axis}`] = Math.max(next[`min${axis}`], section.bounds[`min${axis}`]);
      next[`max${axis}`] = Math.min(next[`max${axis}`], section.bounds[`max${axis}`]);
    } else if (section?.kind === "plane" && section.axis.toUpperCase() === axis) {
      if (section.keep === "below")
        next[`max${axis}`] = Math.min(next[`max${axis}`], section.offset);
      else next[`min${axis}`] = Math.max(next[`min${axis}`], section.offset);
    }
    if (next[`min${axis}`] > next[`max${axis}`]) return null;
  }
  return next;
}

/** Datums span the picture, not an invented building footprint. Keep the nearest enclosing levels.
 * All other datums remain in the root inventory; none changes the camera fit. */
export function levelExtents(levels: SceneLevels, bounds: Bounds) {
  const x = (bounds.minX + bounds.maxX) / 2,
    y = (bounds.minY + bounds.maxY) / 2;
  const height = (p: LevelPlane, x: number, y: number) =>
    p.point[2]! -
    (p.normal[0]! * (x - p.point[0]!) + p.normal[1]! * (y - p.point[1]!)) / p.normal[2]!;
  const stack = levels.planes.flatMap((plane, index) =>
    Math.abs(plane.normal[2]!) > 1e-8 ? [{ plane, index, z: height(plane, x, y) }] : [],
  );
  const below = Math.max(-Infinity, ...stack.filter((p) => p.z < bounds.minZ).map((p) => p.z));
  const above = Math.min(Infinity, ...stack.filter((p) => p.z > bounds.maxZ).map((p) => p.z));
  return stack
    .filter((p) => p.z >= Math.min(bounds.minZ, below) && p.z <= Math.max(bounds.maxZ, above))
    .map((p) => ({
      ...p,
      corners: [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.minY],
        [bounds.maxX, bounds.maxY],
        [bounds.minX, bounds.maxY],
      ].map(([x, y]) => [x!, y!, height(p.plane, x!, y!)]),
    }));
}

/** One quiet perimeter per measured datum. The group owns disposal; no fill obscures the model. */
export function levelLayer(levels: SceneLevels, bounds: Bounds): Layer3D {
  const positions = levelExtents(levels, bounds).flatMap(({ corners }) =>
    corners.flatMap((point, i) => [...point, ...corners[(i + 1) % corners.length]!]),
  );
  const materials = new WeakMap<THREE.Group, THREE.LineBasicMaterial>();
  return {
    key: "model-levels",
    build(group) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      materials.set(group, material);
      group.add(new THREE.LineSegments(geometry, material));
    },
    frame(group, at) {
      if (at.ink) materials.get(group)?.color.copy(at.ink);
      return false;
    },
  };
}

/** PSC1 is an external boundary; a corrupt datum must not put a plausible line in the picture. */
export function assertLevels(levels: SceneLevels) {
  const vector = (v: number[]) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!levels || !Array.isArray(levels.sources) || !Array.isArray(levels.planes))
    throw Error("Scene levels are missing. Refresh the scene with the current Revit payload.");
  if (
    levels.sources.some(
      (s, i) =>
        s.source !== i ||
        typeof s.name !== "string" ||
        !["loaded", "unloaded", "unavailable"].includes(s.status) ||
        (s.countedLevels != null &&
          (!Number.isSafeInteger(s.countedLevels) || s.countedLevels < 0)),
    )
  )
    throw Error("Invalid level source metadata");
  for (const p of levels.planes) {
    if (
      !vector(p.point) ||
      !vector(p.normal) ||
      Math.abs(Math.hypot(...p.normal) - 1) > 1e-6 ||
      !Array.isArray(p.members) ||
      !p.members.length ||
      p.members.some(
        (m) =>
          !Number.isSafeInteger(m.source) ||
          !levels.sources[m.source] ||
          !Number.isSafeInteger(m.elementId) ||
          typeof m.name !== "string" ||
          !Number.isFinite(m.projectElevationFt) ||
          (m.scope != null &&
            (!Number.isSafeInteger(m.scope.elementId) || typeof m.scope.name !== "string")),
      )
    )
      throw Error("Invalid level plane metadata");
  }
}
