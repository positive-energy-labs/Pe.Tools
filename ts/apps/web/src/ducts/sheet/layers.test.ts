/**
 * The sheet's picture doors, deterministic: the same half-inch join fixture `finding-layers.test`
 * draws, read as sheet blockers. Token sampling needs a browser canvas, so ink is a fixed colour.
 */
import * as THREE from "three";
import { expect, it, vi } from "vite-plus/test";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { DuctsSheetOverview } from "@pe/agent-contracts";
import type { Detail } from "./api";
import {
  blockerShapes,
  centrelineLayers,
  sheetIssues,
  sheetLayers,
  worstPathLayer,
} from "./layers";
import { detailOf, type SheetBlocker } from "./tiers";

vi.mock("#/scene/ink", () => ({ inkOf: () => new THREE.Color(0xffffff) }));

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
    duct(
      3,
      [30, 0, 0],
      [40, 0, 0],
      [conn(0, [30, 0, 0], [-1, 0, 0]), conn(1, [40, 0, 0], [1, 0, 0])],
    ),
  ],
  issues: [],
  groups: [],
  flows: [],
  levels: [],
  layers: [],
  systems: [],
} as unknown as DuctSnapshot;

const pair: [string, string] = ["1:1", "2:0"];
const join: SheetBlocker = {
  id: "inferred-join:1:1",
  kind: "inferred-join",
  elementId: 1,
  connector: 1,
  effectInWg: null,
  detail: "",
  closer: {
    kind: "heal",
    note: "",
    candidate: { toElementId: 2, toConnector: 0, gapIn: 0.5, pair },
  },
};
const noFlow: SheetBlocker = detailOf({
  id: "no-flow:3",
  kind: "no-flow",
  elementId: 3,
  effectInWg: null,
  closer: "ruling",
});
const shared: SheetBlocker = detailOf({
  id: "shared-leg:3",
  kind: "shared-leg",
  elementId: 3,
  effectInWg: null,
  closer: "ruling",
});
const inputs = (
  rulings: { pair: [string, string]; verdict: "accept" | "reject" }[],
): Detail<"inputs"> => ({
  kind: "inputs",
  target: { session: "s", openId: "o" },
  basis: "b",
  edits: { rulings },
  ends: [],
  inputs: [],
  blockers: [],
});
const overview = { blockers: [] } as unknown as DuctsSheetOverview;
const focus = new Set([1, 2, 3]);

it("an inferred-join blocker keeps only the faces on its own pair", () => {
  const shapes = blockerShapes(snapshot, null, [join, noFlow], null, focus);
  expect(shapes.outlines.length).toBe(2);
  expect(shapes.bars.length).toBe(1);
  expect(shapes.overhang.length).toBeGreaterThan(0);
  expect(shapes.outlines.every((o) => [1, 2].includes(o.elementId))).toBe(true);
});

/** The capped round open end `finding-layers.test` proves draws a cylinder heal volume. */
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
  issues: [{ id: "open-end:1:1", kind: "open-end", elementId: 1, connector: 1, note: "" }],
} as unknown as DuctSnapshot;
const capPair: [string, string] = ["1:1", "cap"];
const openEnd: SheetBlocker = {
  id: "open-end:1:1",
  kind: "open-end",
  elementId: 1,
  connector: 1,
  effectInWg: null,
  detail: "",
  closer: {
    kind: "heal",
    note: "",
    candidate: { toElementId: 1, toConnector: 1, gapIn: 0, pair: capPair },
  },
};

it("a heal volume is a ghost until its pair is accepted, then solid", () => {
  const ghost = blockerShapes(round, null, [openEnd], null, new Set([1]));
  expect(ghost.boxes.length).toBeGreaterThan(0);
  expect(ghost.boxes.every((b) => b.ghost)).toBe(true);
  const solid = blockerShapes(
    round,
    null,
    [openEnd],
    inputs([{ pair: capPair, verdict: "accept" }]),
    new Set([1]),
  );
  expect(solid.boxes.length).toBeGreaterThan(0);
  expect(solid.boxes.every((b) => b.ghost === false)).toBe(true);
});

it("issues name the blocker's elements and the snapshot findings drawn on them", () => {
  const shapes = blockerShapes(snapshot, null, [join, noFlow], null, focus);
  const issues = sheetIssues([join, noFlow], shapes);
  expect(issues[0]).toMatchObject({ key: "inferred-join:1:1", ids: [1, 2], damage: null });
  expect(issues[0]!.findings).toContain("proximity:1:1|2:0");
  expect(issues[1]).toEqual({
    key: "no-flow:3",
    ids: [3],
    findings: ["no-flow:3"],
    damage: "no-flow",
  });
});

it("a consequence issue names its present cause; an orphan stands alone", () => {
  const consequence = { ...noFlow, causedBy: join.id };
  const [, tethered] = sheetIssues([join, consequence], null);
  expect(tethered!.causedBy).toBe(join.id);
  expect(sheetIssues([consequence], null)[0]).not.toHaveProperty("causedBy");
});

it("every face layer answers the blocker row through targets and findings", () => {
  const layers = sheetLayers({
    snapshot,
    work: null,
    overview,
    inputs: null,
    blockers: [join, shared],
    meshes: null,
    worstPathIds: new Set([1, 2]),
    focus,
  });
  const faces = layers.filter((layer) => layer.key.startsWith("finding:"));
  expect(faces.length).toBeGreaterThan(0);
  for (const layer of faces) {
    expect(layer.findings).toEqual(["proximity:1:1|2:0"]);
    expect(layer.targets).toEqual([{ key: "inferred-join:1:1", elementId: expect.any(Number) }]);
  }
  expect(layers.filter((layer) => layer.key.startsWith("sheet-worst:"))).toHaveLength(1);
  const legs = layers.filter((layer) => layer.key.startsWith("sheet-leg:"));
  expect(legs).toHaveLength(1);
  expect(legs[0]!.targets).toEqual([{ key: "shared-leg:3", elementId: 3 }]);
});

it("a centreline layer and the worst path build their marks from the snapshot polylines", () => {
  const [leg] = centrelineLayers(snapshot, [shared]);
  const group = new THREE.Group();
  leg!.build(group);
  expect(group.children).toHaveLength(1);
  const worst = worstPathLayer(snapshot, new Set([1]));
  const heavy = new THREE.Group();
  worst!.build(heavy);
  expect(heavy.children[0]!.userData.weight).toBe(2.5);
  expect(worstPathLayer(snapshot, new Set())).toBeNull();
});
