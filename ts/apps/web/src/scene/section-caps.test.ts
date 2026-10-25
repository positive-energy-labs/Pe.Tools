import { describe, expect, it } from "vite-plus/test";
import { sectionCaps } from "./section-caps";
import { SceneMeshes, type Bounds, type SceneInstance } from "./types";

type Point = [number, number];
const square = (lo: number, hi: number): Point[] => [
  [lo, lo],
  [hi, lo],
  [hi, hi],
  [lo, hi],
];
const bounds: Bounds = { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 };

// Unindexed walls, including independent inner walls, like captured duct tessellation.
function prism(rings: Point[][], axis = 0, lo = -2, hi = 2) {
  const positions: number[] = [];
  const world = (along: number, point: Point) => {
    const p = [0, 0, 0];
    p[axis] = along;
    p[(axis + 1) % 3] = point[0];
    p[(axis + 2) % 3] = point[1];
    return p;
  };
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      positions.push(...world(lo, a), ...world(hi, a), ...world(hi, b));
      positions.push(...world(lo, a), ...world(hi, b), ...world(lo, b));
    }
  }
  return positions;
}

function scene(...soups: number[][]) {
  let firstVertex = 0;
  const instances: SceneInstance[] = soups.map((soup, i) => {
    const instance = {
      key: `instance-${i}`,
      revitId: i + 1,
      documentKey: "capture",
      linkInstanceId: null,
      uniqueId: `unique-${i}`,
      categoryId: null,
      category: "duct",
      focus: true,
      firstVertex,
      vertexCount: soup.length / 3,
    };
    firstVertex += instance.vertexCount;
    return instance;
  });
  return new SceneMeshes(new Float32Array(soups.flat()), bounds, instances);
}

function triangles(positions: Float32Array) {
  return Array.from({ length: positions.length / 9 }, (_, i) => [
    Array.from(positions.slice(i * 9, i * 9 + 3)),
    Array.from(positions.slice(i * 9 + 3, i * 9 + 6)),
    Array.from(positions.slice(i * 9 + 6, i * 9 + 9)),
  ]);
}

function normal(triangle: number[][]) {
  const [a, b, c] = triangle as [number[], number[], number[]];
  const ab = b.map((n, i) => n - a[i]!);
  const ac = c.map((n, i) => n - a[i]!);
  return [
    ab[1]! * ac[2]! - ab[2]! * ac[1]!,
    ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!,
  ];
}

const totalArea = (positions: Float32Array) =>
  triangles(positions).reduce((sum, t) => sum + Math.hypot(...normal(t)) / 2, 0);

function covers(triangle: number[][], u: number, v: number) {
  const sides = triangle.map((a, i) => {
    const b = triangle[(i + 1) % 3]!;
    return (b[1]! - a[1]!) * (v - a[2]!) - (b[2]! - a[2]!) * (u - a[1]!);
  });
  return sides.every((s) => s >= -1e-9) || sides.every((s) => s <= 1e-9);
}

describe("section caps", () => {
  for (const [axis, name] of ["x", "y", "z"].entries()) {
    for (const keep of ["above", "below"] as const) {
      it(`caps a ${name} cut keeping ${keep}, with outward winding`, () => {
        const meshes = scene(prism([square(-2, 2)], axis));
        const [cap] = sectionCaps(meshes, {
          kind: "plane",
          axis: name as "x" | "y" | "z",
          offset: 0.25,
          keep,
        });
        expect(cap!.instance).toBe(meshes.instances[0]);
        expect(totalArea(cap!.positions)).toBeCloseTo(16, 7);
        for (const triangle of triangles(cap!.positions)) {
          for (const p of triangle) expect(p[axis]).toBe(0.25);
          expect(normal(triangle)[axis]! * (keep === "below" ? 1 : -1)).toBeGreaterThan(0);
        }
      });
    }
  }

  it("leaves a hollow duct's center empty regardless of triangle winding or order", () => {
    const soup = prism([square(-2, 2), square(-1, 1)]);
    const shuffled = triangles(new Float32Array(soup))
      .reverse()
      .flatMap((t, i) => (i % 2 ? t.reverse() : t).flat());
    const [cap] = sectionCaps(scene(shuffled), {
      kind: "plane",
      axis: "x",
      offset: 0,
      keep: "below",
    });
    expect(totalArea(cap!.positions)).toBeCloseTo(12, 7);
    for (let y = -0.9; y < 1; y += 0.3) {
      for (let z = -0.9; z < 1; z += 0.3) {
        expect(triangles(cap!.positions).some((t) => covers(t, y, z))).toBe(false);
      }
    }
  });

  it("supports multiple holes, islands nested inside holes, and disconnected solids", () => {
    const shift = (ring: Point[], x: number): Point[] => ring.map(([u, v]) => [u + x, v]);
    const meshes = scene(
      prism([
        square(-4, 4),
        square(-2, 2),
        square(-0.5, 0.5),
        shift(square(-0.25, 0.25), 3),
        shift(square(-1, 1), 10),
      ]),
    );
    const [cap] = sectionCaps(meshes, { kind: "plane", axis: "x", offset: 0, keep: "above" });
    expect(totalArea(cap!.positions)).toBeCloseTo(64 - 16 + 1 - 0.25 + 4, 7);
  });

  it("uses each instance's range and preserves captured identity and geometry", () => {
    const meshes = scene(prism([square(-2, 2)]), prism([square(-1, 1)]));
    const original = meshes.positions.slice();
    const caps = sectionCaps(meshes, { kind: "plane", axis: "x", offset: 0, keep: "below" });
    expect(caps.map((cap) => cap.instance)).toEqual(meshes.instances);
    expect(caps.map((cap) => totalArea(cap.positions))).toEqual([16, 4]);
    expect(meshes.positions).toEqual(original);
  });

  it("does not cap open chains or fill around an open inner wall", () => {
    const incomplete = prism([square(-2, 2)]).slice(18);
    const cut = { kind: "plane", axis: "x", offset: 0, keep: "below" } as const;
    expect(sectionCaps(scene(incomplete), cut)).toEqual([]);
    expect(
      sectionCaps(scene([...prism([square(-2, 2)]), ...prism([square(-1, 1)]).slice(18)]), cut),
    ).toEqual([]);
    // An unrelated intact component still earns a cap.
    const distant = prism([square(-1, 1).map(([u, v]): Point => [u + 10, v])]);
    const [cap] = sectionCaps(scene([...incomplete, ...distant]), cut);
    expect(totalArea(cap!.positions)).toBeCloseTo(4, 7);
  });

  it("welds float32 seams across neighboring hash cells without closing large gaps", () => {
    const soup = prism([square(-2, 2)]);
    // One independently captured quad has a small seam against its neighbor.
    for (let i = 0; i < 18; i += 3) soup[i + 1]! += 4e-7;
    const cut = { kind: "plane", axis: "x", offset: 0, keep: "below" } as const;
    const [cap] = sectionCaps(scene(soup), cut);
    expect(totalArea(cap!.positions)).toBeCloseTo(16, 5);
    for (let i = 0; i < 18; i += 3) soup[i + 1]! += 0.01;
    expect(sectionCaps(scene(soup), cut)).toEqual([]);
  });

  it("ignores duplicate triangles and rejects a branched non-manifold contour", () => {
    const soup = prism([square(-2, 2)]);
    const cut = { kind: "plane", axis: "x", offset: 0, keep: "below" } as const;
    const [cap] = sectionCaps(scene([...soup, ...soup]), cut);
    expect(totalArea(cap!.positions)).toBeCloseTo(16, 7);
    const branch = [-2, -2, -2, 2, -2, -2, 2, 0, 0];
    expect(sectionCaps(scene([...soup, ...branch]), cut)).toEqual([]);
  });

  it("handles cuts through existing tessellation edges and vertices", () => {
    const soup = [...prism([square(-2, 2)], 0, -2, 0), ...prism([square(-2, 2)], 0, 0, 2)];
    for (const keep of ["above", "below"] as const) {
      const [cap] = sectionCaps(scene(soup), { kind: "plane", axis: "x", offset: 0, keep });
      expect(totalArea(cap!.positions)).toBeCloseTo(16, 7);
    }
  });

  it("returns no cap for absent, tangent, coplanar-only or empty intersections", () => {
    const meshes = scene(prism([square(-2, 2)]));
    for (const offset of [-3, -2, 2, 3]) {
      expect(sectionCaps(meshes, { kind: "plane", axis: "x", offset, keep: "above" })).toEqual([]);
    }
    expect(
      sectionCaps(scene([0, 0, 0, 0, 1, 0, 0, 0, 1]), {
        kind: "plane",
        axis: "x",
        offset: 0,
        keep: "below",
      }),
    ).toEqual([]);
    expect(sectionCaps(scene(), { kind: "box", bounds })).toEqual([]);
  });

  it("trims all six box faces even when no captured triangle intersects the box edges", () => {
    // Add the end walls: this is a complete cube, not just four extruded walls.
    const cube = [
      ...prism([square(-2, 2)]),
      -2,
      -2,
      -2,
      -2,
      2,
      -2,
      -2,
      2,
      2,
      -2,
      -2,
      -2,
      -2,
      2,
      2,
      -2,
      -2,
      2,
      2,
      -2,
      -2,
      2,
      2,
      -2,
      2,
      2,
      2,
      2,
      -2,
      -2,
      2,
      2,
      2,
      2,
      -2,
      2,
    ];
    const box = { minX: -0.5, minY: -0.5, minZ: -0.5, maxX: 0.5, maxY: 0.5, maxZ: 0.5 };
    const [cap] = sectionCaps(scene(cube), { kind: "box", bounds: box });
    expect(totalArea(cap!.positions)).toBeCloseTo(6, 7);
    for (const triangle of triangles(cap!.positions)) {
      for (const p of triangle)
        for (const value of p) expect(Math.abs(value)).toBeLessThanOrEqual(0.5);
      const n = normal(triangle);
      expect(n.reduce((dot, value, axis) => dot + value * triangle[0]![axis]!, 0)).toBeGreaterThan(
        0,
      );
    }
  });

  it("keeps hollow material empty when box trimming opens a hole onto a box edge", () => {
    const box = { minX: -1, maxX: 1, minY: -1.5, maxY: 0.5, minZ: -1.5, maxZ: 1.5 };
    const [cap] = sectionCaps(scene(prism([square(-2, 2), square(-1, 1)])), {
      kind: "box",
      bounds: box,
    });
    const xFaces = triangles(cap!.positions).filter((t) => t.every((p) => p[0] === t[0]![0]));
    expect(xFaces.reduce((sum, t) => sum + Math.hypot(...normal(t)) / 2, 0)).toBeCloseTo(6, 7);
    for (const triangle of xFaces) expect(covers(triangle, 0, 0)).toBe(false);
    for (const t of triangles(cap!.positions))
      for (const p of t) {
        expect(p[0]).toBeGreaterThanOrEqual(-1);
        expect(p[0]).toBeLessThanOrEqual(1);
        expect(p[1]).toBeGreaterThanOrEqual(-1.5);
        expect(p[1]).toBeLessThanOrEqual(0.5);
        expect(p[2]).toBeGreaterThanOrEqual(-1.5);
        expect(p[2]).toBeLessThanOrEqual(1.5);
      }
  });

  it("preserves small hollow sections far from the origin", () => {
    const soup = prism([square(-2, 2), square(-1, 1)]).map((n) => n + 100_000);
    const [cap] = sectionCaps(scene(soup), {
      kind: "plane",
      axis: "x",
      offset: 100_000,
      keep: "below",
    });
    expect(totalArea(cap!.positions)).toBeCloseTo(12, 7);
  });

  it("does not erase thin sections when only the cut axis has a large world coordinate", () => {
    const soup = prism([square(-0.01, 0.01)], 0, 999_998, 1_000_002);
    const [cap] = sectionCaps(scene(soup), {
      kind: "plane",
      axis: "x",
      offset: 1_000_000,
      keep: "above",
    });
    expect(totalArea(cap!.positions)).toBeCloseTo(0.0004, 9);
  });
});
