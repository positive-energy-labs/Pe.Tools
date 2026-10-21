import type { RevitDetailSpaceScene } from "@pe/host-contracts/generated";

export type Metadata = RevitDetailSpaceScene.Res.Response["scene"];
export type Element = Metadata["elements"][number];
export type { SpaceViewState as ViewState } from "@pe/agent-contracts/space-view";
import type { SpaceViewState as ViewState } from "@pe/agent-contracts/space-view";
export const elementKey = (element: Element) =>
  JSON.stringify([
    element.handle.documentKey,
    element.handle.linkInstanceId ?? null,
    element.handle.uniqueId,
  ]);

type Point = [number, number];

/** Extend the open cut's end tangents to an enclosing rectangle, then follow its perimeter.
 * The boundary closure lies outside all scene geometry, never across a snaking cut. */
export function cutPolygon(points: Point[], bounds: Metadata["bounds"]): Point[] {
  if (points.length < 2) return [];
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  const x0 = Math.min(bounds.minX, ...xs) - margin,
    x1 = Math.max(bounds.maxX, ...xs) + margin;
  const y0 = Math.min(bounds.minY, ...ys) - margin,
    y1 = Math.max(bounds.maxY, ...ys) + margin;
  const w = x1 - x0,
    h = y1 - y0,
    perimeter = 2 * (w + h);
  const extend = (a: Point, b: Point): { point: Point; at: number } => {
    const dx = a[0] - b[0],
      dy = a[1] - b[1];
    if (Math.hypot(dx, dy) < 0.000001) throw Error("Cut points must be distinct");
    const tx = dx > 0 ? (x1 - a[0]) / dx : dx < 0 ? (x0 - a[0]) / dx : Infinity;
    const ty = dy > 0 ? (y1 - a[1]) / dy : dy < 0 ? (y0 - a[1]) / dy : Infinity;
    const t = Math.min(tx, ty),
      p: Point = [a[0] + t * dx, a[1] + t * dy];
    const at =
      tx < ty
        ? dx > 0
          ? w + p[1] - y0
          : 2 * w + h + y1 - p[1]
        : dy > 0
          ? w + h + x1 - p[0]
          : p[0] - x0;
    return { point: p, at };
  };
  const start = extend(points[0]!, points[1]!);
  const end = extend(points.at(-1)!, points.at(-2)!);
  const corners: { point: Point; at: number }[] = [
    { point: [x1, y0], at: w },
    { point: [x1, y1], at: w + h },
    { point: [x0, y1], at: 2 * w + h },
    { point: [x0, y0], at: perimeter },
  ];
  const finish = start.at <= end.at ? start.at + perimeter : start.at;
  const boundary = [...corners, ...corners.map((c) => ({ ...c, at: c.at + perimeter }))]
    .filter((c) => c.at > end.at && c.at < finish)
    .map((c) => c.point);
  const polygon = [start.point, ...points, end.point, ...boundary];
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  // A crossing path has no single retained side, including when an end extension crosses a bend.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      const c = polygon[j]!,
        d = polygon[(j + 1) % polygon.length]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        throw Error(
          "Cut crosses itself or its end extensions. Move a bend or change the end direction.",
        );
    }
  }
  return polygon;
}

export function insidePolygon(x: number, y: number, points: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (a[1]! > y !== b[1]! > y && x < ((b[0]! - a[0]!) * (y - a[1]!)) / (b[1]! - a[1]!) + a[0]!)
      inside = !inside;
  }
  return inside;
}

export function retained(
  p: number[],
  state: Pick<ViewState, "plane" | "keepInside">,
  polygon: Point[],
): boolean {
  if (
    state.plane &&
    state.plane[0] * p[0]! + state.plane[1] * p[1]! + state.plane[2] * p[2]! + state.plane[3] < 0
  )
    return false;
  return polygon.length < 3 || insidePolygon(p[0]!, p[1]!, polygon) === state.keepInside;
}

export function decodeScene(buffer: ArrayBuffer): { metadata: Metadata; positions: Float32Array } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== 0x31435350)
    throw Error("Not a PSC1 scene artifact");
  const length = view.getUint32(4, true),
    offset = Math.ceil((8 + length) / 4) * 4;
  if (offset > buffer.byteLength) throw Error("Truncated scene metadata");
  const metadata = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 8, length)),
  ) as Metadata;
  if (
    metadata.format !== "space-scene-v1" ||
    metadata.stamp.frame !== "host-internal-ft" ||
    !Number.isInteger(metadata.triangles) ||
    metadata.triangles < 1 ||
    metadata.triangles > 3000000 ||
    buffer.byteLength - offset !== metadata.triangles * 36
  )
    throw Error("Invalid scene frame or vertex budget");
  let nextVertex = 0;
  for (const e of metadata.elements) {
    if (
      !Number.isInteger(e.firstVertex) ||
      !Number.isInteger(e.vertexCount) ||
      e.firstVertex !== nextVertex ||
      e.vertexCount <= 0 ||
      e.firstVertex % 3 !== 0 ||
      e.vertexCount % 3 !== 0 ||
      e.firstVertex + e.vertexCount > metadata.triangles * 3
    )
      throw Error("Invalid element vertex range");
    nextVertex += e.vertexCount;
  }
  if (nextVertex !== metadata.triangles * 3) throw Error("Incomplete element vertex ranges");
  return { metadata, positions: new Float32Array(buffer, offset) };
}

export function initialView(metadata: Metadata, scene: string): ViewState {
  const b = metadata.bounds;
  const target: [number, number, number] = [
    (b.minX + b.maxX) / 2,
    (b.minY + b.maxY) / 2,
    (b.minZ + b.maxZ) / 2,
  ];
  const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, 1);
  return {
    version: 1,
    scene,
    target,
    camera: [target[0] + radius, target[1] - radius, target[2] + radius],
    hidden: [],
    isolated: null,
    selected: null,
    plane: null,
    polyline: [],
    keepInside: true,
  };
}
