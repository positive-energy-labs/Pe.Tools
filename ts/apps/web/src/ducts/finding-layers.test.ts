/**
 * Findings in 3D, deterministic: a half-inch gap between two 12x12 ends, one offset 3 in sideways,
 * annotated as a join, draws both end faces, the red gap bar between their centres and the
 * overhung edges; an unannotated join draws nothing.
 */
import { expect, it } from "vite-plus/test";

import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { findingLayers, findingShapes, noRunLayers } from "./finding-layers";

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
    "inferred",
    "overhang",
  ]);
});

it("a join the picture does not annotate draws nothing", () => {
  const shapes = findingShapes(snapshot, new Set(), null);
  expect(shapes).toEqual({ outlines: [], bars: [], missedBars: [], overhang: [], boxes: [] });
  expect(findingLayers(shapes)).toEqual([]);
});

it("a possible missed join draws two advisory faces and a separate dotted gap bar", () => {
  const raw = structuredClone(snapshot);
  raw.segments[1]!.polyline[0] = [10 + 2.88 * IN, 0, 0];
  raw.segments[1]!.connectors[0]!.point = [10 + 2.88 * IN, 0, 0];
  const shapes = findingShapes(raw, new Set(), null, new Set([1, 2]));
  expect(shapes.outlines.map((o) => o.ink)).toEqual(["missed", "missed"]);
  expect(shapes.bars).toEqual([]);
  expect(shapes.overhang).toEqual([]);
  expect(shapes.missedBars).toHaveLength(1);
  expect(findingLayers(shapes).map((l) => l.key.split(":")[1])).toEqual([
    "missed",
    "missed-bars",
    "missed",
  ]);
});

it("a chosen system draws its findings without annotations and excludes annotations outside it", () => {
  const raw = {
    ...snapshot,
    issues: [
      { id: "open-end:1:1", kind: "open-end", elementId: 1 },
      { id: "open-end:2:0", kind: "open-end", elementId: 2 },
    ],
  } as DuctSnapshot;
  const scoped = findingShapes(raw, new Set(), null, new Set([1, 2]));
  expect(scoped.bars).toHaveLength(1);
  expect(scoped.outlines.map((o) => o.ink)).toEqual(["inferred", "inferred"]);
  expect(
    findingShapes(snapshot, new Set(["proximity:1:1|2:0"]), null, new Set([3])).bars,
  ).toHaveLength(0);
});

// Chadds ducts.snapshot receipt 17cf1b06-216a-42cb-ae97-95c65e46e82d, 2026-10-23.
// FC-1 has supply and return ports. Its return joins FR-2 on RA 50, below the SA 44 meshes.
const sa44 = {
  ...snapshot,
  nodes: [
    {
      id: 6071117,
      kind: "equipment",
      point: [264.2429, 609.5216, -8.75],
      connectors: [
        {
          ...conn(1, [264.4786, 609.2859, -4.084], [0, 0, 1]),
          widthAxis: [-0.707, -0.707, 0],
          widthIn: 11.129,
          heightIn: 9.129,
        },
        {
          ...conn(3, [264.4786, 609.2859, -8.7171], [0, 0, -1]),
          widthAxis: [-0.707, -0.707, 0],
          widthIn: 26,
          heightIn: 22,
          classification: "ReturnAir",
        },
      ],
    },
    {
      id: 6566361,
      kind: "equipment",
      point: [264.361, 609.14, -9.2796],
      connectors: [
        {
          ...conn(4, [264.361, 609.14, -8.7171], [0, 0, 1]),
          widthAxis: [-0.707, -0.707, 0],
          widthIn: 21.188,
          heightIn: 19.75,
          classification: "ReturnAir",
        },
        {
          ...conn(5, [264.361, 609.14, -9.2796], [0, 0, -1], { elementId: 13218907, connector: 1 }),
          widthAxis: [-0.707, -0.707, 0],
          widthIn: 21.188,
          heightIn: 19.75,
          classification: "ReturnAir",
        },
      ],
    },
    {
      id: 9098869,
      kind: "fitting",
      point: [265.0097, 608.7564, -3.6667],
      connectors: [
        {
          ...conn(1, [265.0097, 608.7564, -3.6667], [-0.707, 0.707, 0]),
          shape: "round",
          diameterIn: 8,
        },
        {
          ...conn(2, [265.2454, 608.5206, -3.6667], [0.707, -0.707, 0], {
            elementId: 9098865,
            connector: 1,
          }),
          shape: "round",
          diameterIn: 8,
        },
      ],
    },
  ],
  segments: [
    {
      ...duct(
        9822717,
        [264.3645, 609.1717, -3.5],
        [264.3645, 609.1717, -4.0833],
        [
          {
            ...conn(0, [264.3645, 609.1717, -3.5], [0, 0, 1], { elementId: 7301872, connector: 1 }),
            widthAxis: [-0.707, -0.707, 0],
            widthIn: 18,
            heightIn: 18,
          },
          {
            ...conn(1, [264.3645, 609.1717, -4.0833], [0, 0, -1]),
            widthAxis: [0.707, 0.707, 0],
            widthIn: 18,
            heightIn: 18,
          },
        ],
      ),
      widthIn: 18,
      heightIn: 18,
      groupId: null,
    },
  ],
} as unknown as DuctSnapshot;

it("SA 44 excludes FC-1's RA 50 return rectangle, 4.634 ft below its duct, even when annotated", () => {
  const returnJoin = "proximity:6071117:3|6566361:4";
  const unscoped = findingShapes(sa44, new Set([returnJoin]), null);
  expect(unscoped.outlines.map((o) => o.outline.center[2])).toEqual([-8.7171, -8.7171]);
  expect(-4.083333492279053 - unscoped.outlines[0]!.outline.center[2]!).toBeCloseTo(4.6337665, 6);
  // The raw system's capture has the fitting and duct; inference bridges FC-1 into its priced tree.
  const scoped = findingShapes(sa44, new Set([returnJoin]), null, new Set([9098869, 9822717]));
  expect(scoped.bars).toHaveLength(2);
  expect(scoped.outlines.map((o) => o.outline.center)).toEqual([
    [264.4786, 609.2859, -4.084],
    [264.3645, 609.1717, -4.0833],
    [265.0097, 608.7564, -3.6667],
    [264.3645, 609.1717, -3.6667],
  ]);
});

it("a heal that caps a round open end draws a cylinder of the duct's diameter", () => {
  const round = {
    ...snapshot,
    segments: [
      {
        ...duct(
          1,
          [0, 0, 0],
          [10, 0, 0],
          [
            { ...conn(0, [0, 0, 0], [-1, 0, 0], { elementId: 9, connector: 0 }), shape: "round" },
            {
              ...conn(1, [10, 0, 0], [1, 0, 0]),
              shape: "round",
              widthIn: null,
              heightIn: null,
              diameterIn: 12,
            },
          ],
        ),
        shape: "round",
        size: "12",
        widthIn: null,
        heightIn: null,
        diameterIn: 12,
      },
    ],
    issues: [
      { id: "open-end:1:1", kind: "open-end", elementId: 1, severity: "warning", message: "" },
    ],
  } as unknown as DuctSnapshot;
  const shapes = findingShapes(round, new Set(), null, new Set([1]));
  const cyl = shapes.boxes.find((b) => b.shape === "cylinder");
  expect(cyl).toBeDefined();
  expect(cyl!.half[0] * 12).toBeCloseTo(6, 3);
});

it("join faces, bars and overhang all carry the same inbox identity", () => {
  const id = "proximity:1:1|2:0";
  const shapes = findingShapes(snapshot, new Set([id]), null);
  const layers = findingLayers(shapes, [
    { key: "heal:g", ids: [999, 2, 1], findings: [id], damage: "blocked" },
  ]);
  expect(layers.length).toBeGreaterThan(0);
  for (const layer of layers) {
    expect(layer.findings).toEqual([id]);
    expect(layer.targets).toHaveLength(1);
    expect(layer.targets![0]!.key).toBe("heal:g");
    expect([1, 2]).toContain(layer.targets![0]!.elementId);
  }
});

it("a no-run branch draws one mark per element, answering the row its reason names first", () => {
  const layers = noRunLayers(
    new Map([[1, { elements: [1, 2], reasons: [{ at: 2, text: "flowless terminal" }] as never }]]),
    snapshot,
    [
      { key: "branch", ids: [1, 2], findings: [], damage: null },
      { key: "terminal", ids: [2], findings: [], damage: "blocked" },
    ],
  );
  expect(layers).toHaveLength(1);
  expect(layers[0]!.targets!.map((t) => t.key)).toEqual(["terminal", "branch"]);
  expect(layers[0]!.targets!.every((t) => t.elementId === 1)).toBe(true);
  expect(noRunLayers(new Map(), snapshot, [])).toEqual([]);
});
