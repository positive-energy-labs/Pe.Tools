/**
 * The lifted kernels price the synthetic network of `apps/web/src/ducts/losses.test.ts` leg by
 * leg, with explicit flows and no tree: unit 100 -> duct 1 -> elbow 2 -> duct 3 (tap 4 at 5 ft)
 * -> transition 5 -> grille 6 (200 cfm, 0.05); tap 4 -> duct 7 -> terminal 8 (100 cfm, 0.08).
 * Expected values were computed independently in Python from the same grids (handcalc.py).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

import type { Grid, Grids } from "../loss-grid.ts";
import type { DuctSnapshot } from "../types.ts";
import { fittingFacts, splitTappedDuct, tapDistance } from "./fitting-facts.ts";
import { equivalentFeet, priceLeg, type PricedLeg } from "./price-leg.ts";

// ---- test-only .tbl reader (ctable.py parse), as in losses.test.ts ----------------------------
function parseTbl(name: string): Record<string, Grid> {
  const text = readFileSync(
    join(__dirname, "../../../../apps/web/src/ducts/fixtures/ashrae", `${name}.tbl`),
    "latin1",
  );
  const out: Record<string, Grid> = {};
  for (const block of text.split(/\r?\n=+\r?\n/)) {
    if (!block.trim() || block.trim().startsWith("'")) continue;
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !/^[#\s]+$/.test(l));
    const title = lines[0]!.trim();
    const rest = lines.slice(1);
    const head = rest.findIndex((l) => l.includes("->"));
    if (head >= 0) {
      const res = rest.find((l) => /^\s*C\w*\s*$/.test(l))?.trim() ?? "Co";
      const [xLabel, xs] = rest[head]!.split("->");
      const y: number[] = [];
      const grid: number[][] = [];
      for (const l of rest.slice(head + 1).filter((l) => /^\s*[-\d.]/.test(l))) {
        const v = l.trim().split(/\s+/).map(Number);
        y.push(v[0]!);
        grid.push(v.slice(1));
      }
      out[res] = { title, xLabel: xLabel!.trim(), x: xs!.trim().split(/\s+/).map(Number), yLabel: rest[head + 1]!.trim(), y, grid };
    } else {
      const header = rest.find((l) => /\d+\(\d+\)/.test(l))!;
      const x = [...header.matchAll(/(\d+(?:\.\d+)?)\(\d+\)/g)].map((m) => Number(m[1]));
      const co = rest.find((l) => l.trim().startsWith("Co"))!;
      out.Co = { title, xLabel: "D", x, grid: co.trim().split(/\s+/).slice(1).map(Number) };
    }
  }
  return out;
}
const grids: Grids = {
  "CD3-2": parseTbl("Cd3-2"),
  "SD5-9": parseTbl("Sd5-9"),
  "SR4-3": parseTbl("Sr4-3"),
};

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Conn = Node["connectors"][number];
const round = (d: number) => ({ shape: "round" as const, size: `${d}`, diameterIn: d });
const rect = (w: number, h: number) => ({ shape: "rectangular" as const, size: `${w}x${h}`, widthIn: w, heightIn: h });
const conn = (index: number, to: [number, number] | null, size: object, kind = "end", point = [0, 0, 0]): Conn =>
  ({ index, kind, point, direction: "out", connectedTo: to ? { elementId: to[0], connector: to[1] } : null, ...size }) as Conn;
const node = (id: number, kind: string, extra: object): Node =>
  ({ id, kind, category: "", point: [0, 0, 0], groupId: "g1", facts: [], ...extra }) as unknown as Node;
const duct = (id: number, lengthFt: number, size: object, polyline: number[][], connectors: Conn[]): Segment =>
  ({ id, kind: "duct", curveKind: "line", ...size, lengthFt, polyline, groupId: "g1", roughness: { valueFt: 0.0003, provenance: "revit-default" }, revit: {}, connectors }) as unknown as Segment;

const elbow = node(2, "fitting", {
  partType: "Elbow",
  connectors: [conn(0, [1, 1], round(8)), conn(1, [3, 0], round(8))],
  facts: [{ key: "rOverD", value: 1, unit: "", provenance: "geometry" }],
});
const tap = node(4, "fitting", {
  partType: "TapAdjustable",
  connectors: [conn(0, [3, 2], round(6), "curve"), conn(1, [7, 0], round(6))],
  facts: [{ key: "mainSegment", value: 3, unit: "", provenance: "geometry" }],
});
const transition = node(5, "fitting", {
  partType: "Transition",
  connectors: [{ ...conn(0, [3, 1], round(8)), direction: "in" }, conn(1, [6, 0], rect(12, 4))],
  facts: [{ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" }],
});
const grille = node(6, "terminal", { connectors: [conn(0, [5, 1], rect(12, 4))] });
const terminal8 = node(8, "terminal", { connectors: [conn(0, [7, 1], round(6))] });
const duct1 = duct(1, 10, round(8), [[0, 0, 0], [10, 0, 0]], [conn(0, [100, 0], round(8), "end", [0, 0, 0]), conn(1, [2, 0], round(8), "end", [10, 0, 0])]);
const duct3 = duct(3, 12, round(8), [[10, 0, 0], [10, 12, 0]], [
  conn(0, [2, 1], round(8), "end", [10, 0, 0]),
  conn(1, [5, 0], round(8), "end", [10, 12, 0]),
  conn(2, [4, 0], round(6), "curve", [10, 5, 0]),
]);
const duct7 = duct(7, 3, round(6), [[10, 5, 0], [10, 5, 3]], [conn(0, [4, 1], round(6)), conn(1, [8, 0], round(6))]);

const T6 = 0.09187933;
const T8 = 0.16736657;
const sum = (legs: PricedLeg[]) => legs.reduce((a, l) => a + (l.lossInWg ?? 0), 0);

it("tapDistance measures from the asserted upstream end", () => {
  expect(tapDistance(duct3, tap, duct3.connectors[0])).toBeCloseTo(5, 9);
  expect(tapDistance(duct3, tap, duct3.connectors[1])).toBeCloseTo(7, 9);
});

it("splits a tapped duct into Cs legs (passed) and a Cb leg (left by)", () => {
  const passed = splitTappedDuct({ duct: duct3, upstream: duct3.connectors[0], upstreamCfm: 300, taps: [{ tap, branchCfm: 100 }] });
  expect(passed.map((p) => p.kind)).toEqual(["friction", "tap-straight", "friction"]);
  expect(passed[0]).toMatchObject({ lengthFt: 5, cfm: 300 });
  expect(passed[1]).toMatchObject({ leg: "Cs", flows: { through: 300, branch: 100, upstreamMain: 300, downstreamMain: 200 }, atFt: 5 });
  expect(passed[2]).toMatchObject({ lengthFt: 7, cfm: 200 });
  const left = splitTappedDuct({ duct: duct3, upstream: duct3.connectors[0], upstreamCfm: 300, taps: [{ tap, branchCfm: 100 }], leaveBy: 4 });
  expect(left.map((p) => p.kind)).toEqual(["friction", "tap-branch"]);
  expect(left[1]).toMatchObject({ leg: "Cb", flows: { through: 100, branch: 100, upstreamMain: 300, downstreamMain: 200 } });
  // A tap with no branch flow is passed without a leg.
  expect(splitTappedDuct({ duct: duct3, upstream: duct3.connectors[0], upstreamCfm: 300, taps: [{ tap, branchCfm: 0 }] }).map((p) => p.kind)).toEqual(["friction", "friction"]);
});

it("prices the synthetic network leg by leg to the independently computed totals", () => {
  const common = [
    priceLeg({ kind: "duct", segment: duct1, lengthFt: 10, cfm: 300 }, grids),
    priceLeg({ kind: "fitting", fitting: elbow, facts: fittingFacts({ fitting: elbow, inlet: elbow.connectors[0], outlet: elbow.connectors[1] }), flows: { through: 300 }, leg: "C" }, grids),
    priceLeg({ kind: "duct", segment: duct3, lengthFt: 5, cfm: 300 }, grids),
  ];
  expect(common.map((l) => l.lossInWg)).toEqual([expect.closeTo(0.0152039, 6), expect.closeTo(0.0110481, 6), expect.closeTo(0.007602, 6)]);
  expect(common[1]!.source).toMatchObject({ kind: "rule", rule: "elbow-1d-le10", table: "CD3-2", coefficient: expect.closeTo(0.24, 6) });
  const tapFacts = fittingFacts({ fitting: tap, inlet: tap.connectors[0], outlet: undefined, main: duct3 });
  expect(tapFacts.takeoff).toBe(true);
  const t6 = [
    ...common,
    priceLeg({ kind: "fitting", fitting: tap, facts: tapFacts, flows: { through: 300, branch: 100, upstreamMain: 300, downstreamMain: 200 }, leg: "Cs" }, grids),
    priceLeg({ kind: "duct", segment: duct3, lengthFt: 7, cfm: 200 }, grids),
    priceLeg({ kind: "fitting", fitting: transition, facts: fittingFacts({ fitting: transition, inlet: transition.connectors[0], outlet: transition.connectors[1] }), flows: { through: 200 }, leg: "C" }, grids),
    priceLeg({ kind: "drop", element: grille, cfm: 200, inWg: 0.05, source: "parameter" }, grids),
  ];
  expect(t6.every((l) => l.unpriced == null)).toBe(true);
  expect(t6[3]!.lossInWg).toBeCloseTo(0.0027961, 6);
  expect(t6[5]!.source).toMatchObject({ kind: "rule", rule: "trx-grille", table: "SR4-3" });
  expect(sum(t6)).toBeCloseTo(T6, 7);
  const t8 = [
    ...common,
    priceLeg({ kind: "fitting", fitting: tap, facts: tapFacts, flows: { through: 100, branch: 100, upstreamMain: 300, downstreamMain: 200 }, leg: "Cb" }, grids),
    priceLeg({ kind: "duct", segment: duct7, lengthFt: 3, cfm: 100 }, grids),
    priceLeg({ kind: "drop", element: terminal8, cfm: 100, inWg: 0.08, source: "typed" }, grids),
  ];
  expect(t8[3]!.source).toMatchObject({ kind: "rule", rule: "tap-std", table: "SD5-9", coefficient: expect.closeTo(3.15333, 4) });
  expect(t8[3]!.lossInWg).toBeCloseTo(0.0509751, 6);
  expect(sum(t8)).toBeCloseTo(T8, 7);
  // Equivalent feet: a duct is its own length, a rule leg converts at the feeding duct's rate, a typed drop stays in-wg.
  const eq = equivalentFeet(t8);
  expect(eq[0]).toBe(10);
  expect(eq[1]).toBeCloseTo((0.0110481 / (0.0152039 / 10 / 1)) , 1);
  expect(eq[5]).toBeNull();
});

it("names why a leg is unpriced: a table not loaded, a tap with no branch flow, a missing drop", () => {
  const tapFacts = fittingFacts({ fitting: tap, inlet: tap.connectors[0], outlet: undefined, main: duct3 });
  expect(priceLeg({ kind: "fitting", fitting: tap, facts: tapFacts, flows: { through: 300, branch: 0, upstreamMain: 300, downstreamMain: 300 }, leg: "Cs" }, grids).unpriced).toMatch(/no branch flow/);
  const facts = fittingFacts({ fitting: elbow, inlet: elbow.connectors[0], outlet: elbow.connectors[1] });
  expect(priceLeg({ kind: "fitting", fitting: elbow, facts, flows: { through: 300 }, leg: "C" }, {}).unpriced).toBe("CD3-2 Co is not loaded");
  expect(priceLeg({ kind: "fitting", fitting: elbow, facts, flows: { through: 300 }, leg: "C", statedInWg: 0.02 }, {})).toMatchObject({ lossInWg: 0.02, source: { kind: "drop", source: "typed" } });
  expect(priceLeg({ kind: "drop", element: grille, cfm: 200, inWg: null, source: "firm default" }, grids).unpriced).toMatch(/no drop/);
});
