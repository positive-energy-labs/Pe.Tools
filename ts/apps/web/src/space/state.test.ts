import { spaceViewSchema } from "@pe/agent-contracts/space-view";
import { describe, expect, it } from "vite-plus/test";
import {
  AXES,
  SHADER_POINTS,
  cutPolygon,
  cutPolygons,
  deleteNode,
  dragEdge,
  emptyCut,
  frameRect,
  fromFrame,
  insertNode,
  offsetCut,
  decodeScene,
  initialView,
  insidePolygon,
  packPolygons,
  retained,
  seedCut,
  toFrame,
  type Axis,
  type Cut,
  type Cuts,
  type Metadata,
  type Point,
} from "./state";

const bounds = { minX: -2, minY: -2, minZ: -100, maxX: 8, maxY: 9, maxZ: 100 };
const metadata = { bounds } as Metadata;
const rect = frameRect("top", bounds);
const open = (polyline: [number, number][], offset = 0) => ({ polyline, closed: false, offset });
const keep = { ...emptyCut, keepInside: true };
const only = (axis: Axis, cut: Cut): Cuts => ({
  top: emptyCut,
  north: emptyCut,
  east: emptyCut,
  [axis]: cut,
});
const topOnly = (polygon: Point[], keepInside = true) => ({
  cuts: only("top", { ...keep, keepInside }),
  polygons: { top: polygon, north: [], east: [] },
});
/** A line-for-line mirror of the GLSL `spaceClip`, reading only the packed uniform data. */
function shaderKeeps(packed: ReturnType<typeof packPolygons>, local: number[]): boolean {
  const frameOf = (a: number, p: number[]) =>
    a === 0 ? [p[0]!, p[1]!] : a === 1 ? [-p[0]!, p[2]!] : [p[1]!, p[2]!];
  for (let a = 0; a < 3; a++) {
    const n = packed.counts[a]!;
    if (n < 3) continue;
    const q = frameOf(a, local);
    const at = (i: number) => {
      const k = (a * SHADER_POINTS + i) * 2;
      return [packed.data[k]!, packed.data[k + 1]!];
    };
    let inside = false;
    for (let i = 0; i < n; i++) {
      const A = at(i),
        B = at(i === 0 ? n - 1 : i - 1);
      if (
        A[1]! > q[1]! !== B[1]! > q[1]! &&
        q[0]! < ((B[0]! - A[0]!) * (q[1]! - A[1]!)) / (B[1]! - A[1]!) + A[0]!
      )
        inside = !inside;
    }
    if (inside !== packed.keepInside[a]) return false;
  }
  return true;
}

describe("Space cuts and portable state", () => {
  it("keeps the left side of an open snaking cut without a diagonal closing cut", () => {
    const polyline: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [1, 4],
      [1, 7],
      [6, 7],
    ];
    const polygon = cutPolygon(open(polyline), rect);
    const kept = (p: number[], keepInside = true, shape = polygon) => {
      const { cuts, polygons } = topOnly(shape, keepInside);
      return retained(p, cuts, polygons);
    };
    expect(insidePolygon(0.5, 2, polyline)).toBe(false);
    expect(kept([0.5, 2, 0])).toBe(true);
    expect(kept([2, 2, -100])).toBe(true);
    expect(kept([2, 2, 100])).toBe(true);
    expect(kept([2, 5, 0])).toBe(false);
    expect(kept([2, 8, 0])).toBe(true);
    expect(kept([2, 5, 0], false)).toBe(true);
    const reversed = cutPolygon(open([...polyline].reverse()), rect);
    expect(kept([2, 5, 0], true, reversed)).toBe(true);
    expect(kept([2, 2, 0], true, reversed)).toBe(false);
  });
  it("extends two point cuts to scope and bounds the shader polygon", () => {
    const polygon = cutPolygon(
      open([
        [0, 0],
        [1, 0],
      ]),
      rect,
    );
    expect(insidePolygon(7, 8, polygon)).toBe(true);
    expect(insidePolygon(7, -1, polygon)).toBe(false);
    const maximum: [number, number][] = Array.from({ length: 56 }, (_, i) => [i, Math.sin(i)]);
    expect(cutPolygon(open(maximum), rect).length).toBeLessThanOrEqual(64);
    expect(cutPolygon(open([[0, 0]]), rect)).toEqual([]);
    expect(() =>
      cutPolygon(
        open([
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
        ]),
        rect,
      ),
    ).toThrow("crosses");
  });
  it("keeps a closed polygon's inside, offsets with mitred bends, and rejects crossings", () => {
    const square: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const kept = (p: number[], shape: Point[], keepInside = true) => {
      const { cuts, polygons } = topOnly(shape, keepInside);
      return retained(p, cuts, polygons);
    };
    const closed = cutPolygon({ polyline: square, closed: true, offset: 0 }, rect);
    expect(closed).toEqual(square);
    expect(kept([2, 2, 50], closed)).toBe(true);
    expect(kept([6, 2, 50], closed)).toBe(false);
    expect(kept([6, 2, 50], closed, false)).toBe(true);
    // Counter-clockwise: the left normal points inward, so a positive offset shrinks the polygon.
    expect(offsetCut({ polyline: square, closed: true, offset: 1 })).toEqual([
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]);
    const shrunk = cutPolygon({ polyline: square, closed: true, offset: 1 }, rect);
    expect(kept([0.5, 2, 0], shrunk)).toBe(false);
    expect(kept([2, 2, 0], shrunk)).toBe(true);
    // Open ends shift along their own segment normal; the bend is mitred.
    expect(offsetCut({ polyline: square.slice(0, 3), closed: false, offset: 1 })).toEqual([
      [0, 1],
      [3, 1],
      [3, 4],
    ]);
    expect(() => cutPolygon({ polyline: square, closed: true, offset: 3 }, rect)).toThrow(
      "Reduce the offset",
    );
    expect(cutPolygon({ polyline: square, closed: true, offset: -3 }, rect)).toHaveLength(4);
    expect(() =>
      cutPolygon(
        {
          polyline: [
            [0, 0],
            [4, 4],
            [4, 0],
            [0, 4],
          ],
          closed: true,
          offset: 0,
        },
        rect,
      ),
    ).toThrow("crosses itself");
    expect(() =>
      offsetCut({
        polyline: [
          [0, 0],
          [4, 0],
          [0, 0.0001],
        ],
        closed: false,
        offset: 1,
      }),
    ).toThrow("too sharp");
  });
  it("roundtrips the canonical state and rejects malformed or unbounded state", () => {
    const base = initialView(metadata, "a".repeat(64));
    const line: Point[] = [
      [0, 0],
      [1, 1],
    ];
    const state = {
      ...base,
      hidden: ["host:one"],
      cuts: only("north", { ...keep, polyline: line }),
    };
    const withNorth = (cut: object) => ({ ...state, cuts: { ...state.cuts, north: cut } });
    expect(spaceViewSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(
      spaceViewSchema.safeParse(withNorth({ ...keep, polyline: line, closed: true })).success,
    ).toBe(false);
    expect(spaceViewSchema.safeParse(withNorth({ ...keep, polyline: [[0, 0]] })).success).toBe(
      false,
    );
    expect(
      spaceViewSchema.safeParse(withNorth({ ...keep, polyline: line, offset: Infinity })).success,
    ).toBe(false);
    expect(
      spaceViewSchema.safeParse(withNorth({ ...keep, polyline: Array(57).fill([0, 0]) })).success,
    ).toBe(false);
    expect(spaceViewSchema.safeParse({ ...state, plane: null }).success).toBe(false);
    // A saved version 1 view keeps its plan cut as the top cut; the straight plane is retired.
    const legacy = {
      version: 1,
      scene: base.scene,
      camera: base.camera,
      target: base.target,
      hidden: [],
      isolated: null,
      selected: null,
      plane: [1, 0, 0, -2],
      polyline: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
      keepInside: false,
      closed: true,
      offset: 0.5,
    };
    expect(spaceViewSchema.parse(legacy)).toEqual({
      ...base,
      cuts: only("top", {
        polyline: legacy.polyline as Point[],
        closed: true,
        offset: 0.5,
        keepInside: false,
      }),
    });
    expect(() => decodeScene(new ArrayBuffer(8))).toThrow("PSC1");
  });
  it("decodes aligned binary vertices and rejects overlapping element ranges", () => {
    const make = (firstVertex: number) => {
      const json = new TextEncoder().encode(
        JSON.stringify({
          format: "space-scene-v1",
          stamp: { frame: "host-internal-ft" },
          triangles: 1,
          elements: [{ firstVertex, vertexCount: 3 }],
          bounds,
        }),
      );
      const offset = Math.ceil((8 + json.length) / 4) * 4;
      const buffer = new ArrayBuffer(offset + 36);
      const header = new DataView(buffer);
      header.setUint32(0, 0x31435350, true);
      header.setUint32(4, json.length, true);
      new Uint8Array(buffer, 8, json.length).set(json);
      new Float32Array(buffer, offset).set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      return buffer;
    };
    expect([...decodeScene(make(0)).positions]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => decodeScene(make(3))).toThrow("range");
  });
  it("maps each axis frame right-handed and back, and frames the scene bounds per axis", () => {
    const p = [3, -1, 7];
    for (const axis of AXES) expect(fromFrame(axis, ...toFrame(axis, p))).toEqual(p);
    // Top looks down Z with X right; North looks south (-X right, Z up); East looks west (Y right, Z up).
    expect(toFrame("top", p)).toEqual([3, -1, 7]);
    expect(toFrame("north", p)).toEqual([-3, 7, -1]);
    expect(toFrame("east", p)).toEqual([-1, 7, 3]);
    expect(frameRect("north", bounds)).toEqual({ u0: -8, u1: 2, v0: -100, v1: 100, w0: -2, w1: 9 });
    expect(frameRect("east", bounds)).toEqual({ u0: -2, u1: 9, v0: -100, v1: 100, w0: -2, w1: 8 });
  });
  it("keeps the intersection of the three axis cuts, and an empty axis clips nothing", () => {
    const box = (axis: Axis) => seedCut(frameRect(axis, bounds), "box");
    expect(
      retained([100, 100, 1000], only("top", emptyCut), cutPolygons(only("top", emptyCut), bounds)),
    ).toBe(true);
    const cuts: Cuts = { top: box("top"), north: box("north"), east: box("east") };
    const polygons = cutPolygons(cuts, bounds);
    expect(retained([3, 3.5, 0], cuts, polygons)).toBe(true);
    // Outside the top box (x) only; outside the north box (z) only; outside the east box (y) only.
    expect(retained([-1.9, 3.5, 0], cuts, polygons)).toBe(false);
    expect(retained([3, 3.5, 90], cuts, polygons)).toBe(false);
    expect(
      retained(
        [3, 8.9, 0],
        only("east", box("east")),
        cutPolygons(only("east", box("east")), bounds),
      ),
    ).toBe(false);
    // A north section line keeps +v (up, +Z) of its left side; reversing keeps below.
    const line = seedCut(frameRect("north", bounds), "line");
    const lineCuts = only("north", line);
    const linePolygons = cutPolygons(lineCuts, bounds);
    expect(retained([3, 3, 50], lineCuts, linePolygons)).toBe(true);
    expect(retained([3, 3, -50], lineCuts, linePolygons)).toBe(false);
    const flipped = only("north", { ...line, keepInside: false });
    expect(retained([3, 3, -50], flipped, cutPolygons(flipped, bounds))).toBe(true);
  });
  it("feeds the GPU exactly the polygons CPU picking reads", () => {
    const cuts: Cuts = {
      top: {
        ...keep,
        closed: true,
        polyline: [
          [0, 0],
          [6, 0],
          [6, 2],
          [2, 2],
          [2, 6],
          [0, 6],
        ],
      },
      north: {
        ...keep,
        keepInside: false,
        polyline: [
          [-7, -20],
          [-1, 30],
        ],
      },
      east: {
        ...keep,
        closed: true,
        offset: -0.5,
        polyline: [
          [-1, -80],
          [8, -80],
          [8, 80],
          [-1, 80],
        ],
      },
    };
    const polygons = cutPolygons(cuts, bounds);
    const origin = [3, 3.5, 0];
    const packed = packPolygons(polygons, cuts, origin);
    let kept = 0;
    for (let x = -1.93; x < 8; x += 0.37)
      for (let y = -1.91; y < 9; y += 0.41)
        for (let z = -97.3; z < 100; z += 9.7) {
          const cpu = retained([x, y, z], cuts, polygons);
          expect(shaderKeeps(packed, [x - origin[0]!, y - origin[1]!, z - origin[2]!])).toBe(cpu);
          if (cpu) kept++;
        }
    // Every axis really clips: the agreement is not over an all-kept or all-cut volume.
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(27 * 27 * 21);
  });
  it("inserts and deletes nodes within the minimum valid shape", () => {
    const line: Cut = {
      ...keep,
      polyline: [
        [0, 0],
        [4, 0],
      ],
    };
    const bent = insertNode(line, 0, [2, 1]) as Cut;
    expect(bent.polyline).toEqual([
      [0, 0],
      [2, 1],
      [4, 0],
    ]);
    expect(deleteNode(bent, 1)).toEqual(line);
    // Removing a node from a two-node line removes its last edge: the cut clears.
    expect(deleteNode(line, 0)).toBeNull();
    const triangle: Cut = {
      ...keep,
      closed: true,
      polyline: [
        [0, 0],
        [4, 0],
        [0, 4],
      ],
    };
    expect(deleteNode(triangle, 0)).toMatch("three nodes");
    expect(
      insertNode(
        { ...keep, polyline: Array.from({ length: 56 }, (_, i) => [i, 0] as Point) },
        0,
        [0.5, 1],
      ),
    ).toMatch("56");
  });
  it("folds a dragged edge along its neighbours and collapses a chamfer into its corner", () => {
    const bevel: Cut = {
      ...keep,
      closed: true,
      polyline: [
        [0, 0],
        [10, 0],
        [10, 8],
        [8, 10],
        [0, 10],
      ],
    };
    // Pushed northeast past where x = 10 and y = 10 meet: the chamfer becomes the square corner.
    for (const delta of [
      [1, 1],
      [3, 3],
      [2, 0.5],
    ] as Point[]) {
      const result = dragEdge(bevel, 2, delta);
      expect(result.collapsed).toBe(true);
      expect(result.cut.polyline).toEqual([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]);
      expect(() => cutPolygon(result.cut, rect)).not.toThrow();
    }
    // Short of the corner, the ends slide along x = 10 and y = 10; the chamfer stays at 45 degrees.
    const short = dragEdge(bevel, 2, [0.5, 0.5]);
    expect(short.collapsed).toBe(false);
    expect(short.cut.polyline.slice(2, 4)).toEqual([
      [10, 9],
      [9, 10],
    ]);
    // Pulled inward it grows along the same supporting lines; it never collapses away from the corner.
    const inward = dragEdge(bevel, 2, [-1, -1]);
    expect(inward.collapsed).toBe(false);
    expect(inward.cut.polyline.slice(2, 4)).toEqual([
      [10, 6],
      [6, 10],
    ]);
    // Non-perpendicular neighbours meet where they meet, not at 90 degrees.
    const skew: Cut = {
      ...keep,
      closed: true,
      polyline: [
        [0, 0],
        [10, 0],
        [12, 6],
        [8, 9],
        [0, 9],
      ],
    };
    const skewed = dragEdge(skew, 2, [5, 5]);
    expect(skewed.collapsed).toBe(true);
    const corner = skewed.cut.polyline[2]!;
    expect(corner[1]).toBeCloseTo(9);
    expect(corner[0]).toBeCloseTo(13);
    // Parallel neighbours have no finite corner: the edge just moves, it never collapses.
    const slot: Cut = {
      ...keep,
      closed: true,
      polyline: [
        [0, 0],
        [10, 0],
        [10, 4],
        [0, 4],
      ],
    };
    const pushed = dragEdge(slot, 1, [50, 0]);
    expect(pushed.collapsed).toBe(false);
    expect(pushed.cut.polyline).toEqual([
      [0, 0],
      [60, 0],
      [60, 4],
      [0, 4],
    ]);
    // A triangle would fall below three nodes: no collapse.
    const triangle: Cut = {
      ...keep,
      closed: true,
      polyline: [
        [0, 0],
        [4, 0],
        [0, 4],
      ],
    };
    expect(dragEdge(triangle, 1, [10, 10]).collapsed).toBe(false);
    // A two-node line has no neighbours and translates freely.
    expect(
      dragEdge(
        {
          ...keep,
          polyline: [
            [0, 0],
            [4, 0],
          ],
        },
        0,
        [1, 2],
      ).cut.polyline,
    ).toEqual([
      [1, 2],
      [5, 2],
    ]);
    // An open cut's end edge slides its inner end along the neighbour and shifts its free end.
    const hook: Cut = {
      ...keep,
      polyline: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
    };
    expect(dragEdge(hook, 0, [7, 1]).cut.polyline).toEqual([
      [0, 1],
      [4, 1],
      [4, 4],
    ]);
  });
  it("rejects an offset longer than a segment allows", () => {
    const square: Point[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(() =>
      cutPolygons(only("east", { ...keep, polyline: square, closed: true, offset: 3 }), bounds),
    ).toThrow("East cut: Offset is longer");
    expect(
      cutPolygons(only("east", { ...keep, polyline: square, closed: true, offset: -3 }), bounds)
        .east,
    ).toHaveLength(4);
  });
});
