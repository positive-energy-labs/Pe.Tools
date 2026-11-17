/** Overhang geometry, deterministic: two offset square faces overhang by exactly the offset. */
import { expect, it } from "vite-plus/test";

import { outlineOf, overhang, type Edge } from "./faces.ts";

const rect = { shape: "rectangular", widthIn: 12, heightIn: 12, diameterIn: null } as const;
const length = (edges: Edge[]) =>
  edges.reduce((s, [p, q]) => s + Math.hypot(...p.map((v, k) => v - q[k]!)), 0);

it("two 12 in faces offset 3 in sideways overhang by 3 in along two edges and 12 in along one", () => {
  const a = outlineOf(rect, [0, 0, 0], [1, 0, 0], [0, 1, 0])!;
  // b faces back at a, 1/2 in off along the run, 3 in (0.25 ft) toward +y.
  const b = outlineOf(rect, [0.04, 0.25, 0], [-1, 0, 0], [0, 1, 0])!;
  const ofA = overhang(a, b);
  // The y = -0.5 edge is wholly outside b (1.0 ft); the two z edges each lose 0.25 ft.
  expect(length(ofA)).toBeCloseTo(1.0 + 0.25 * 2, 3);
  expect(ofA.every(([p, q]) => p[1]! <= -0.25 + 1e-6 && q[1]! <= -0.25 + 1e-6)).toBe(true);
  expect(length(overhang(b, a))).toBeCloseTo(1.0 + 0.25 * 2, 3);
});

it("coincident faces overhang nothing", () => {
  const a = outlineOf(rect, [0, 0, 0], [1, 0, 0], [0, 1, 0])!;
  expect(overhang(a, outlineOf(rect, [0, 0, 0], [-1, 0, 0], [0, 1, 0])!)).toEqual([]);
});
