import type { SceneSection } from "@pe/agent-contracts";
import type { Bounds } from "./types";
import type { ClipVolume } from "./renderer";

export type Section = SceneSection;
export type SectionAxis = "x" | "y" | "z";
export const SECTION_AXES = ["x", "y", "z"] as const;
export const limitsOf = (bounds: Bounds, axis: SectionAxis) =>
  [
    bounds[`min${axis.toUpperCase() as "X" | "Y" | "Z"}`],
    bounds[`max${axis.toUpperCase() as "X" | "Y" | "Z"}`],
  ] as const;

export function fitSection(bounds: Bounds, padding: number): Section {
  const p = Math.max(0.01, padding);
  return {
    kind: "box",
    bounds: {
      minX: bounds.minX - p,
      minY: bounds.minY - p,
      minZ: bounds.minZ - p,
      maxX: bounds.maxX + p,
      maxY: bounds.maxY + p,
      maxZ: bounds.maxZ + p,
    },
  };
}

/** Inward planes, normal.xyz and constant; a point is kept when every dot >= 0. */
export function sectionPlanes(section: Section | null): number[][] {
  if (!section) return [];
  if (section.kind === "plane") {
    const sign = section.keep === "above" ? 1 : -1;
    const normal = SECTION_AXES.map((axis) => (axis === section.axis ? sign : 0));
    return [[...normal, -sign * section.offset]];
  }
  return SECTION_AXES.flatMap((axis, i) => {
    const [lo, hi] = limitsOf(section.bounds, axis);
    const normal = SECTION_AXES.map((_, n) => (n === i ? 1 : 0));
    return [
      [...normal, -lo],
      [...normal.map((v) => -v), hi],
    ];
  });
}

export const sectionContains = (section: Section | null, point: readonly number[]) =>
  sectionPlanes(section).every(
    (p) => p[0]! * point[0]! + p[1]! * point[1]! + p[2]! * point[2]! + p[3]! >= -1e-6,
  );

/** Preserve the exact cut face when converting world float32 cap vertices to batch-local feet. */
export function rebaseCaps(positions: Float32Array, section: Section, origin: readonly number[]) {
  const cuts: number[][] = [[], [], []];
  for (const plane of sectionPlanes(section)) {
    const axis = plane.slice(0, 3).findIndex((n) => n !== 0);
    cuts[axis]!.push(-plane[3]! / plane[axis]!);
  }
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    const face = cuts[axis]!.find((n) => Math.fround(n) === positions[i]);
    positions[i] = (face ?? positions[i]!) - origin[axis]!;
  }
  return positions;
}

/** Typed authoring enters the existing clip seam; polygon cuts can coexist with these planes. */
export const sectionVolume = (section: Section | null): ClipVolume | null =>
  section && {
    data: new Float32Array(0),
    counts: [0, 0, 0],
    keepInside: [true, true, true],
    section,
  };

/** Shader parity for existing extruded polygon cuts as well as authored sections. */
export function clipContains(
  volume: ClipVolume | null | undefined,
  point: readonly number[],
  origin: readonly number[],
): boolean {
  if (!volume) return true;
  if (!sectionContains(volume.section ?? null, point)) return false;
  const p = point.map((n, i) => n - origin[i]!);
  const frames = [
    [p[0]!, p[1]!],
    [-p[0]!, p[2]!],
    [p[1]!, p[2]!],
  ];
  for (let a = 0; a < 3; a++) {
    const count = volume.counts[a] ?? 0;
    if (count < 3) continue;
    const [x, y] = frames[a]!;
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const at = a * (volume.data.length / 3);
      const ax = volume.data[at + i * 2]!,
        ay = volume.data[at + i * 2 + 1]!;
      const bx = volume.data[at + j * 2]!,
        by = volume.data[at + j * 2 + 1]!;
      if (ay > y! !== by > y! && x! < ((bx - ax) * (y! - ay)) / (by - ay) + ax) inside = !inside;
    }
    if (inside !== volume.keepInside[a]) return false;
  }
  return true;
}
