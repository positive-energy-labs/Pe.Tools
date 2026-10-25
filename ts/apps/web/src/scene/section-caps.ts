import { ShapeUtils, Vector2 } from "three";
import type { Section } from "./section";
import type { SceneInstance, SceneMeshes } from "./types";

type Face = { axis: number; offset: number; normal: number };
type Loop = { points: Vector2[]; area: number; parent: number };
type Node = { point: Vector2; edges: Set<number> };

/** World-foot triangles, grouped by captured instance; cavities use the even/odd fill rule. */
export function sectionCaps(
  meshes: SceneMeshes,
  section: Section,
): { instance: SceneInstance; positions: Float32Array }[] {
  const faces: Face[] =
    section.kind === "plane"
      ? [
          {
            axis: "xyz".indexOf(section.axis),
            offset: section.offset,
            normal: section.keep === "below" ? 1 : -1,
          },
        ]
      : [
          { axis: 0, offset: section.bounds.minX, normal: -1 },
          { axis: 0, offset: section.bounds.maxX, normal: 1 },
          { axis: 1, offset: section.bounds.minY, normal: -1 },
          { axis: 1, offset: section.bounds.maxY, normal: 1 },
          { axis: 2, offset: section.bounds.minZ, normal: -1 },
          { axis: 2, offset: section.bounds.maxZ, normal: 1 },
        ];
  const bounds = section.kind === "box" ? section.bounds : null;
  const limits = bounds
    ? [
        [bounds.minX, bounds.maxX],
        [bounds.minY, bounds.maxY],
        [bounds.minZ, bounds.maxZ],
      ]
    : null;

  return meshes.instances.flatMap((instance) => {
    const start = instance.firstVertex * 3;
    const end = start + instance.vertexCount * 3;
    const magnitude = [1, 1, 1];
    for (let i = start; i < end; i++) {
      const axis = (i - start) % 3;
      magnitude[axis] = Math.max(magnitude[axis]!, Math.abs(meshes.positions[i]!));
    }
    // Captures duplicate vertices per triangle, so shared endpoints can differ by a float32 ULP.
    const tolerance = magnitude.map((value) => Math.max(1e-6, value * 2 ** -23));
    const positions: number[] = [];
    for (const face of faces) {
      const u = (face.axis + 1) % 3;
      const v = (face.axis + 2) % 3; // u × v points along the positive cut axis.
      const areaTolerance = tolerance[u]! * tolerance[v]!;
      const { loops, open } = contours(meshes.positions, start, end, face, u, v, tolerance);
      const rings: Loop[] = loops.map((points) => ({
        points,
        area: Math.abs(area(points)),
        parent: -1,
      }));
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i]!;
        for (let j = 0; j < rings.length; j++) {
          const candidate = rings[j]!;
          if (
            candidate.area > ring.area &&
            (ring.parent < 0 || candidate.area < rings[ring.parent]!.area) &&
            contains(candidate.points, ring.points[0]!)
          )
            ring.parent = j;
        }
      }
      const depth = (ring: Loop) => {
        let result = 0;
        for (let p = ring.parent; p >= 0; p = rings[p]!.parent) result++;
        return result;
      };
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i]!;
        if (depth(ring) % 2 || open.some((point) => contains(ring.points, point))) continue;
        // An open inner wall cannot silently turn its surrounding closed wall into solid material.
        const holes = rings.filter((child) => child.parent === i).map((child) => child.points);
        const vertices = ring.points.concat(...holes);
        for (const indices of ShapeUtils.triangulateShape(ring.points, holes)) {
          let polygon = indices.map((index) => vertices[index]!);
          if (limits) {
            polygon = clip(polygon, 0, limits[u]![0]!, true);
            polygon = clip(polygon, 0, limits[u]![1]!, false);
            polygon = clip(polygon, 1, limits[v]![0]!, true);
            polygon = clip(polygon, 1, limits[v]![1]!, false);
          }
          for (let k = 1; k + 1 < polygon.length; k++) {
            const triangle = [polygon[0]!, polygon[k]!, polygon[k + 1]!];
            const signed = area(triangle);
            if (Math.abs(signed) <= areaTolerance) continue;
            if (signed * face.normal < 0) triangle.reverse();
            for (const point of triangle) {
              const world = [0, 0, 0];
              world[face.axis] = face.offset;
              world[u] = point.x;
              world[v] = point.y;
              positions.push(...world);
            }
          }
        }
      }
    }
    return positions.length ? [{ instance, positions: new Float32Array(positions) }] : [];
  });
}

function contours(
  positions: Float32Array,
  start: number,
  end: number,
  face: Face,
  u: number,
  v: number,
  tolerance: number[],
) {
  const tu = tolerance[u]!;
  const tv = tolerance[v]!;
  const depthTolerance = tolerance[face.axis]!;
  const nodes: Node[] = [];
  const buckets = new Map<string, number[]>();
  const nodeAt = (point: Vector2) => {
    const x = Math.floor(point.x / tu);
    const y = Math.floor(point.y / tv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of buckets.get(`${x + dx},${y + dy}`) ?? []) {
          const other = nodes[id]!.point;
          if (Math.hypot((other.x - point.x) / tu, (other.y - point.y) / tv) <= 1) return id;
        }
      }
    }
    const id = nodes.length;
    nodes.push({ point, edges: new Set() });
    const key = `${x},${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(id);
    buckets.set(key, bucket);
    return id;
  };
  let below = false;
  let above = false;
  for (let i = start; i + 8 < end; i += 9) {
    const points: Vector2[] = [];
    const distances = [0, 3, 6].map((k) => {
      const distance = positions[i + k + face.axis]! - face.offset;
      below ||= distance < -depthTolerance;
      above ||= distance > depthTolerance;
      return Math.abs(distance) <= depthTolerance ? 0 : distance;
    });
    // Coplanar faces are already drawn. Use the removed side to own edges lying on the plane.
    if (
      !distances.some((distance) => distance * face.normal > 0) ||
      distances.every((distance) => distance * face.normal > 0)
    )
      continue;
    for (let k = 0; k < 3; k++) {
      const next = (k + 1) % 3;
      const a = distances[k]!;
      const b = distances[next]!;
      const pa = new Vector2(positions[i + k * 3 + u]!, positions[i + k * 3 + v]!);
      if (a === 0) points.push(pa);
      if (a * b < 0) {
        const pb = new Vector2(positions[i + next * 3 + u]!, positions[i + next * 3 + v]!);
        points.push(pa.lerp(pb, a / (a - b)));
      }
    }
    if (points.length !== 2) continue;
    const a = nodeAt(points[0]!);
    const b = nodeAt(points[1]!);
    if (a === b) continue;
    nodes[a]!.edges.add(b);
    nodes[b]!.edges.add(a);
  }
  const loops: Vector2[][] = [];
  const open: Vector2[] = [];
  if (!below || !above) return { loops, open };
  const visited = new Set<number>();
  for (let seed = 0; seed < nodes.length; seed++) {
    if (visited.has(seed)) continue;
    const component = [seed];
    visited.add(seed);
    for (let i = 0; i < component.length; i++) {
      for (const next of nodes[component[i]!]!.edges) {
        if (visited.has(next)) continue;
        visited.add(next);
        component.push(next);
      }
    }
    if (component.some((id) => nodes[id]!.edges.size !== 2)) {
      for (const id of component) open.push(nodes[id]!.point);
      continue;
    }
    const loop: Vector2[] = [];
    let previous = -1;
    let current = seed;
    do {
      const node = nodes[current]!;
      loop.push(node.point);
      const next = Array.from(node.edges).find((id) => id !== previous)!;
      previous = current;
      current = next;
    } while (current !== seed);
    if (loop.length >= 3 && Math.abs(area(loop)) > tu * tv) loops.push(loop);
  }
  return { loops, open };
}

/** Translate first: shoelace cancellation otherwise loses small sections far from the origin. */
function area(points: Vector2[]) {
  const origin = points[0]!;
  let sum = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    sum += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  }
  return sum / 2;
}

function contains(loop: Vector2[], point: Vector2) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!;
    const b = loop[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      inside = !inside;
  }
  return inside;
}

/** Clip triangulated material, so holes that open onto a box edge remain empty. */
function clip(polygon: Vector2[], axis: number, offset: number, above: boolean) {
  const result: Vector2[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const da = a.getComponent(axis) - offset;
    const db = b.getComponent(axis) - offset;
    const aInside = above ? da >= 0 : da <= 0;
    const bInside = above ? db >= 0 : db <= 0;
    if (aInside) result.push(a);
    if (aInside !== bInside) result.push(a.clone().lerp(b, da / (da - db)));
  }
  return result;
}
