import { expect, test } from "vite-plus/test";
import { sceneViewSchema, routeAddress } from "@pe/agent-contracts";
import {
  axisBounds,
  CUT_AXES,
  cutPolygon,
  emptyCuts,
  mergeCut,
  moveCutEdge,
  packCuts,
  sectionCuts,
  type Point,
} from "./cuts";
import { clipContains, rebaseClip, sectionContains, sectionVolume } from "./section";
import { sectionProject } from "./projection";

const bounds = { minX: -10, minY: -10, minZ: -10, maxX: 10, maxY: 10, maxZ: 10 };
const l: Point[] = [
  [0, 0],
  [4, 0],
  [4, 1],
  [1, 1],
  [1, 4],
  [0, 4],
];
const section = () => {
  const cuts = emptyCuts();
  cuts.top = { ...cuts.top, polyline: l, closed: true };
  return { kind: "cuts" as const, cuts };
};

test("P3-D concave Top, North and East intersect in world feet, including rebased focus", () => {
  const s = section();
  s.cuts.north = {
    ...s.cuts.north,
    polyline: [
      [-1, 0],
      [0, 0],
      [0, 3],
      [-1, 3],
    ],
    closed: true,
  };
  s.cuts.east = {
    ...s.cuts.east,
    polyline: [
      [0, 1],
      [4, 1],
      [4, 3],
      [0, 3],
    ],
    closed: true,
  };
  const origin = [0, 0, 0],
    focus = [123, -50, 11];
  const volume = packCuts(s.cuts, bounds, origin);
  for (const [p, keep] of [
    [[0.5, 3, 2], true],
    [[3, 3, 2], false],
    [[0.5, 3, 4], false],
    [[0.5, 3, 0.5], false],
  ] as const) {
    expect(sectionContains(s, p, bounds)).toBe(keep);
    expect(clipContains(volume, p, origin)).toBe(keep);
    expect(clipContains(rebaseClip(volume, origin, focus), p, focus)).toBe(keep);
  }
  const shift = [1000000.125, -2000000.25, 3000000.5];
  const shifted = emptyCuts();
  for (const axis of CUT_AXES) {
    const d =
      axis === "top"
        ? [shift[0]!, shift[1]!]
        : axis === "north"
          ? [-shift[0]!, shift[2]!]
          : [shift[1]!, shift[2]!];
    shifted[axis] = {
      ...s.cuts[axis],
      polyline: s.cuts[axis].polyline.map((p) => [p[0] + d[0]!, p[1] + d[1]!]),
    };
  }
  const moved = {
    minX: bounds.minX + shift[0]!,
    maxX: bounds.maxX + shift[0]!,
    minY: bounds.minY + shift[1]!,
    maxY: bounds.maxY + shift[1]!,
    minZ: bounds.minZ + shift[2]!,
    maxZ: bounds.maxZ + shift[2]!,
  };
  const p = [0.5 + shift[0]!, 3 + shift[1]!, 2 + shift[2]!];
  expect(clipContains(packCuts(shifted, moved, shift), p, shift)).toBe(true);
  expect(sectionVolume(s, bounds)?.section).toBeUndefined(); // no fabricated polygon caps
});

test("P3-D open ends close to the left, flip and apply offset exactly once", () => {
  const s = section();
  s.cuts.top = {
    polyline: [
      [-2, 0],
      [2, 0],
    ],
    closed: false,
    offset: 2,
    keepInside: true,
  };
  expect(sectionContains(s, [0, 3, 0], bounds)).toBe(true);
  expect(sectionContains(s, [0, 1, 0], bounds)).toBe(false);
  expect(clipContains(packCuts(s.cuts, bounds, [0, 0, 0]), [0, 3, 0], [0, 0, 0])).toBe(true);
  s.cuts.top.keepInside = false;
  expect(sectionContains(s, [0, 1, 0], bounds)).toBe(true);
});

test("P3-D refuses crossing, degeneracy and packed overflow; authored bound remains 56", () => {
  const s = section();
  s.cuts.top.polyline = [
    [0, 0],
    [4, 4],
    [0, 4],
    [4, 0],
  ];
  expect(() => packCuts(s.cuts, bounds, [0, 0, 0])).toThrow(/cross/);
  s.cuts.top.polyline = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  expect(() => packCuts(s.cuts, bounds, [0, 0, 0])).toThrow(/overlap|area|fold/);
  s.cuts.top.polyline = Array.from({ length: 57 }, (_, i) => [i, i * i]);
  expect(sceneViewSchema.safeParse({ preset: "all", section: s }).success).toBe(false);
  s.cuts.top.polyline = Array.from({ length: 56 }, (_, i) => [
    Math.cos((i * 2 * Math.PI) / 56),
    Math.sin((i * 2 * Math.PI) / 56),
  ]);
  expect(cutPolygon(s.cuts.top, axisBounds(bounds, "top"))).toHaveLength(56);
  const crowded = {
    ...s.cuts.top,
    closed: false,
    offset: 0.01,
    polyline: Array.from({ length: 56 }, (_, i): Point => [i * 0.1, (i % 2) * 10]),
  };
  expect(() => cutPolygon(crowded, axisBounds(bounds, "top"))).toThrow(/64 packed/);
  const address = routeAddress("ducts");
  expect(
    address.read(address.write({ sceneView: { preset: "all", section: s } })).page.sceneView
      .section,
  ).toEqual(s);
});

test("P3-D clipped annotation anchors and crossing lines follow the concave polygon", () => {
  const s = section(),
    project = sectionProject((p) => [p[0]!, p[1]!], s, bounds);
  expect(project([3, 3, 2])).toBeNull();
  expect(project([0.5, 3, 2])).toEqual([0.5, 3]);
  expect(
    project.lines?.([
      [-1, 3, 2],
      [5, 3, 2],
    ]),
  ).toEqual([
    [
      [0, 3, 2],
      [1, 3, 2],
    ],
  ]);
  s.cuts.top.keepInside = false;
  const outside = sectionProject((p) => [p[0]!, p[1]!], s, bounds);
  expect(
    outside.lines?.([
      [-1, 3, 2],
      [5, 3, 2],
    ]),
  ).toEqual([
    [
      [-1, 3, 2],
      [0, 3, 2],
    ],
    [
      [1, 3, 2],
      [5, 3, 2],
    ],
  ]);
});

test("P3-D explicit box and plane conversion preserves halfspaces; neighbours merge in screen pixels", () => {
  for (const axis of ["x", "y", "z"] as const)
    for (const keep of ["above", "below"] as const) {
      const plane = { kind: "plane" as const, axis, keep, offset: 2 };
      const s = { kind: "cuts" as const, cuts: sectionCuts(plane, bounds) };
      for (const p of [
        [1, 1, 1],
        [3, 3, 3],
      ])
        expect(sectionContains(s, p, bounds)).toBe(sectionContains(plane, p));
    }
  const box = { kind: "box" as const, bounds: { ...bounds, maxX: 2 } };
  const s = { kind: "cuts" as const, cuts: sectionCuts(box, bounds) };
  expect(sectionContains(s, [3, 0, 0], bounds)).toBe(false);
  expect(
    mergeCut(
      {
        ...emptyCuts().top,
        polyline: [
          [0, 0],
          [0.5, 0],
          [2, 0],
        ],
      },
      10,
    ).polyline,
  ).toEqual([
    [0, 0],
    [2, 0],
  ]);
  const bevel = {
    ...emptyCuts().top,
    polyline: [
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 4],
    ] as Point[],
  };
  expect(moveCutEdge(bevel, 1, [2, -2]).polyline).toEqual([
    [0, 0],
    [4, 0],
    [4, 4],
  ]);
});
