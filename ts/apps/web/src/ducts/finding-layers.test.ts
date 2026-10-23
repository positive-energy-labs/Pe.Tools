/**
 * Findings in 3D, deterministic: a half-inch gap between two 12x12 ends, one offset 3 in sideways,
 * annotated as a join, draws both end faces, the red gap bar between their centres and the
 * overhung edges; an unannotated join draws nothing.
 */
import { expect, it } from "vite-plus/test";

import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { findingLayers, findingShapes } from "./finding-layers";

const IN = 1 / 12;
const conn = (index: number, point: number[], facing: number[], connectedTo = null as unknown) => ({
  index,
  kind: "end",
  point,
  facing,
  widthAxis: [0, 1, 0],
  shape: "rectangular",
  size: "12x12",
  widthIn: 12,
  heightIn: 12,
  diameterIn: null,
  direction: "bidirectional",
  classification: "SupplyAir",
  connectedTo,
  areaFt2: 1,
});
const duct = (id: number, a: number[], b: number[], connectors: unknown[]) => ({
  id,
  kind: "duct",
  curveKind: "line",
  type: "Rect",
  shape: "rectangular",
  size: "12x12",
  widthIn: 12,
  heightIn: 12,
  diameterIn: null,
  lengthFt: Math.hypot(...a.map((v, k) => v - b[k]!)),
  polyline: [a, b],
  levelId: 1,
  groupId: "g",
  systemName: "SA 1",
  classification: "Supply Air",
  connectors,
});
const gap = 0.5 * IN;
const snapshot = {
  nodes: [],
  segments: [
    duct(
      1,
      [0, 0, 0],
      [10, 0, 0],
      [
        conn(0, [0, 0, 0], [-1, 0, 0], { elementId: 9, connector: 0 }),
        conn(1, [10, 0, 0], [1, 0, 0]),
      ],
    ),
    duct(
      2,
      [10 + gap, 3 * IN, 0],
      [20, 3 * IN, 0],
      [
        conn(0, [10 + gap, 3 * IN, 0], [-1, 0, 0]),
        conn(1, [20, 3 * IN, 0], [1, 0, 0], { elementId: 9, connector: 1 }),
      ],
    ),
  ],
  issues: [],
  groups: [],
  flows: [],
  levels: [],
  layers: [],
  systems: [],
} as unknown as DuctSnapshot;

it("an annotated near-miss draws both faces, the gap bar and the overhung edges", () => {
  const id = "proximity:1:1|2:0";
  const shapes = findingShapes(snapshot, new Set([id]), null);
  expect(shapes.outlines.map((o) => o.ink)).toEqual(["inferred", "inferred"]);
  expect(shapes.bars).toHaveLength(1);
  const [p, q] = shapes.bars[0]!;
  expect(Math.hypot(...p.map((v, k) => v - q[k]!)) * 12).toBeCloseTo(Math.hypot(0.5, 3), 3);
  const overhung = shapes.overhang.reduce(
    (s, [a, b]) => s + Math.hypot(...a.map((v, k) => v - b[k]!)),
    0,
  );
  // Each 12 in face overhangs the other by one whole 12 in edge and two 3 in edges.
  expect(overhung * 12).toBeCloseTo(2 * (12 + 2 * 3), 2);
  expect(findingLayers(shapes).map((l) => l.key.split(":")[1])).toEqual([
    "inferred",
    "bars",
    "overhang",
  ]);
});

it("a join the picture does not annotate draws nothing", () => {
  const shapes = findingShapes(snapshot, new Set(), null);
  expect(shapes).toEqual({ outlines: [], bars: [], overhang: [], boxes: [] });
  expect(findingLayers(shapes)).toEqual([]);
});
