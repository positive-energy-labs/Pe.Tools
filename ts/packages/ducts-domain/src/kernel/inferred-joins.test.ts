/**
 * Inferred-join geometry, deterministic, adapted from `proximity.test.ts` without groups or a
 * snapshot rewrite: a small gap is an end-to-end candidate, a wide one is none, a branch end off a
 * main's side is a tap candidate at its station, a landing on an open mouth is a collar, ends of
 * different classifications stay out without an accept ruling, and a reject ruling drops a pair.
 */
import { expect, it } from "vite-plus/test";

import type { DuctSnapshot } from "../types.ts";
import { applyConnectorPairRulings, candidates, openPortsOf } from "./inferred-joins.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

const IN = 1 / 12;
const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));
const conn = (index: number, point: number[]): Connector => ({
  index,
  kind: "end",
  point,
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  direction: "bidirectional",
  classification: "SupplyAir",
  connectedTo: null,
  areaFt2: 0.196,
});
const duct = (id: number, a: number[], b: number[]): Segment => ({
  id,
  kind: "duct",
  curveKind: "line",
  type: "Round Duct",
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  lengthFt: dist(a, b),
  polyline: [a, b],
  levelId: 1,
  groupId: "g1",
  systemName: "SA 1",
  classification: "Supply Air",
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [conn(1, a), conn(2, b)],
  uniqueId: null,
});
const rect = (id: number, a: number[], b: number[], w: number, h: number): Segment => {
  const s = duct(id, a, b);
  const sized = { shape: "rectangular" as const, size: `${w}x${h}`, widthIn: w, heightIn: h };
  return {
    ...s,
    ...sized,
    diameterIn: null,
    connectors: s.connectors.map((c) => ({ ...c, ...sized, diameterIn: null })),
  };
};
const returnAir = (s: Segment): Segment => ({
  ...s,
  classification: "Return Air",
  connectors: s.connectors.map((c) => ({ ...c, classification: "ReturnAir" })),
});
const grille = (id: number, at: number[], facing: number[]): Node => ({
  id,
  kind: "terminal",
  category: "Air Terminals",
  family: "Grille",
  type: "6",
  partType: null,
  levelId: 1,
  point: at,
  groupId: "g1",
  systemName: "SA 1",
  classification: "Supply Air",
  connectors: [{ ...conn(1, at), facing }],
  facts: [],
  uniqueId: null,
});
const endOf = (s: Segment, index: number) => openPortsOf(s).find((p) => p.index === index)!;

it("a 0.4 in facing gap is a near-miss end-to-end candidate; 2.88 in is none", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const near = candidates(endOf(a, 2), [duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0])]);
  expect(near).toMatchObject([
    {
      kind: "end-to-end",
      toElement: 2,
      toConnector: 1,
      pair: ["1:2", "2:1"],
      gapIn: expect.closeTo(0.4, 6),
      grade: "near-miss",
      crossing: false,
    },
  ]);
  expect(near[0]!.facingDot).toBeCloseTo(-1, 6);
  expect(candidates(endOf(a, 2), [duct(2, [10 + 2.88 * IN, 0, 0], [20, 0, 0])])).toEqual([]);
});

it("a branch end 0.3 in off a main's side is a tap candidate at its station", () => {
  const main = duct(1, [0, 0, 0], [20, 0, 0]);
  const branch = duct(2, [10, 3.3 * IN, 0], [10, 10, 0]);
  expect(candidates(endOf(branch, 1), [main])).toMatchObject([
    {
      kind: "tap",
      toElement: 1,
      toConnector: null,
      pair: ["2:1", "1"],
      gapIn: expect.closeTo(0.3, 6),
      atFt: expect.closeTo(10, 6),
      point: [10, 0, 0],
      grade: "stretched",
    },
  ]);
  // Alongside the main, pointing along it: no landing.
  const alongside = duct(3, [5, 1, 0], [15, 1, 0]);
  expect(candidates(endOf(alongside, 2), [main])).toEqual([]);
});

it("a 10 in branch on a 30x30 plenum's side 0.5 in off taps it; a grille 2 in off-centre on a duct mouth is a collar", () => {
  const plenum = rect(1, [0, 0, 0], [10, 0, 0], 30, 30);
  const y = (15 + 0.5) * IN;
  const branch = { ...duct(2, [3, y, 0], [3, y + 5, 0]), diameterIn: 10 };
  branch.connectors = branch.connectors.map((c) => ({ ...c, diameterIn: 10 }));
  expect(candidates(endOf(branch, 1), [plenum])).toMatchObject([
    { kind: "tap", toElement: 1, gapIn: expect.closeTo(0.5, 6), atFt: expect.closeTo(3, 6) },
  ]);
  const g = grille(9, [10 + 0.5 * IN, 2 * IN, 0], [-1, 0, 0]);
  expect(candidates(openPortsOf(g)[0]!, [plenum])).toMatchObject([
    {
      kind: "collar",
      toElement: 1,
      toConnector: 2,
      pair: ["1:2", "9:1"],
      gapIn: expect.closeTo(0.5, 6),
      grade: "stretched",
    },
  ]);
});

it("ends of different classifications are crossing: out without an accept, anomalous with one; a reject drops a pair", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const b = returnAir(duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0]));
  const found = candidates(endOf(a, 2), [b]);
  expect(found).toMatchObject([{ kind: "end-to-end", crossing: true, grade: "anomalous" }]);
  expect(applyConnectorPairRulings(found, [])).toEqual([]);
  expect(
    applyConnectorPairRulings(found, [{ pair: ["2:1", "1:2"], verdict: "accept" }]),
  ).toMatchObject([{ pair: ["1:2", "2:1"], ruled: true, grade: "anomalous" }]);
  const same = candidates(endOf(a, 2), [duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0])]);
  expect(applyConnectorPairRulings(same, [{ pair: ["1:2", "2:1"], verdict: "reject" }])).toEqual(
    [],
  );
  expect(applyConnectorPairRulings(same, [])).toHaveLength(1);
});

it("candidates rank nearest first and an accepted pair moves to the front", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const nearer = duct(2, [10 + 0.2 * IN, 0, 0], [20, 0, 0]);
  const farther = duct(3, [10 + 0.8 * IN, 0, 0], [20, 0, 0]);
  const found = candidates(endOf(a, 2), [farther, nearer]);
  expect(found.map((c) => c.toElement)).toEqual([2, 3]);
  expect(
    applyConnectorPairRulings(found, [{ pair: ["1:2", "3:1"], verdict: "accept" }]).map((c) => [
      c.toElement,
      c.ruled ?? false,
    ]),
  ).toEqual([
    [3, true],
    [2, false],
  ]);
});
