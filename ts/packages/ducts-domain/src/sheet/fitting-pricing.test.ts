/**
 * Fitting assignment on the fan sheet (ducts LEDGER 2026-10-29: `ruleAssignments` by family, then
 * the rule's own match; `rules[key].table` swaps the table). The case is Chadds MUAS-1's two round
 * elbows 14513278 and 14513371: family "Round Elbow", type 1.5 D, 7 in, centre radius 10.5 in
 * (r/D 1.5) at 35 degrees, which no rule matches (the 1.5 D rules are 90 or 45 degrees exactly).
 */
import { expect, it } from "vite-plus/test";

import type { FanPort } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import { buildSheet, resolveInputs, type SheetSnapshot } from "./index.ts";
import { grids } from "./tables.fixture.ts";
import { inputsFor, TEST_FIRM } from "./test-inputs.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Conn = Node["connectors"][number];
const round = (d: number) => ({ shape: "round" as const, size: `${d}`, diameterIn: d });
const conn = (index: number, to: [number, number] | null, d = 8): Conn =>
  ({
    index,
    kind: "end",
    point: [0, 0, 0],
    direction: "out",
    connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
    ...round(d),
  }) as Conn;
const node = (id: number, kind: string, extra: object): Node =>
  ({ id, kind, category: "", point: [0, 0, 0], facts: [], ...extra }) as unknown as Node;
const duct = (id: number, a: [number, number], b: [number, number]): Segment =>
  ({
    id,
    kind: "duct",
    curveKind: "line",
    ...round(8),
    lengthFt: 10,
    polyline: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: [conn(0, a), conn(1, b)],
  }) as unknown as Segment;
const elbow = (id: number, a: [number, number], b: [number, number], facts: object[]) =>
  node(id, "fitting", {
    family: "Round Elbow",
    type: "1.5 D",
    partType: "Elbow",
    connectors: [conn(0, a), conn(1, b)],
    facts,
  });

// Supply: unit 100:0 -> duct 1 -> elbow 2 (r/D 1.5, 35 deg) -> duct 3 -> elbow 4 (r/D 1, matched) -> duct 5 -> grille 6.
// Return: unit 100:1 -> duct 9 -> grille 10.
const network: SheetSnapshot = {
  nodes: [
    node(100, "equipment", { connectors: [conn(0, [1, 0]), conn(1, [9, 0])] }),
    elbow(2, [1, 1], [3, 0], [
      { key: "angle", value: 35, unit: "deg", provenance: "geometry" },
      { key: "centerRadius", value: 12, unit: "in", provenance: "geometry" },
    ]),
    elbow(4, [3, 1], [5, 0], [{ key: "rOverD", value: 1, unit: "", provenance: "geometry" }]),
    node(6, "terminal", { connectors: [conn(0, [5, 1])] }),
    node(10, "terminal", { connectors: [conn(0, [9, 1])] }),
  ],
  segments: [duct(1, [100, 0], [2, 0]), duct(3, [2, 1], [4, 0]), duct(5, [4, 1], [6, 0]), duct(9, [100, 1], [10, 0])],
  document: { title: "elbows", readAt: "2026-10-29", elapsedMs: 0, networkBasedCalculations: false },
};
const roster: FanPort[] = [
  { unitId: 100, portIndex: 0, inletPortIndex: 1, tag: "MUAS", side: "supply", kind: "muas", source: "ruling" },
];
const sheetWith = (extra: Parameters<typeof inputsFor>[1] = {}) =>
  buildSheet({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster,
    grids,
    inputs: inputsFor(network, { endCfm: { 6: 150, 10: 150 }, drops: { 6: 0.03, 10: 0.03 }, ...extra }),
  });

it("an elbow no rule matches is not priced, and its blocker names a census row offering the elbow rules", () => {
  const sheet = sheetWith();
  expect(sheet.totals.requiredEspInWg).toBeNull();
  const blocker = sheet.blockers.find((b) => b.kind === "not-priced")!;
  expect(blocker).toMatchObject({ id: "not-priced:2", elementId: 2, fitting: "2" });
  const row = sheet.fittings.find((f) => f.key === "2")!;
  expect(row).toMatchObject({ family: "Round Elbow", rule: null, table: null, ruleSource: "none" });
  expect(row.unpriced).toMatch(/no rule matches/);
  const rule = row.candidates.find((c) => c.rule === "elbow-15d-45-le10")!;
  expect(rule.tables).toContain("CD3-3");
  expect(rule.words).toContain("1.5 D die stamped");
  expect(row.candidates.every((c) => c.rule.startsWith("elbow-"))).toBe(true);
  // The matched elbow of the same family shows its auto-matched rule and default table.
  expect(sheet.fittings.find((f) => f.key === "4")).toMatchObject({
    rule: "elbow-1d-le10",
    table: "CD3-2",
    ruleSource: "matched",
    tableSource: "default",
  });
});

it("assigning the family a rule closes the blocker, prices the elbow on that table, and never reprices a matched elbow", () => {
  const before = sheetWith().fittings.find((f) => f.key === "4")!;
  const sheet = sheetWith({ assignments: { "Round Elbow": "elbow-15d-45-le10" } });
  expect(sheet.blockers).toEqual([]);
  expect(sheet.totals.requiredEspInWg).not.toBeNull();
  const row = sheet.fittings.find((f) => f.key === "2")!;
  expect(row).toMatchObject({
    rule: "elbow-15d-45-le10",
    table: "CD3-3",
    ruleSource: "assigned",
    tableSource: "default",
    unpriced: null,
  });
  expect(row.lossInWg).toBeGreaterThan(0);
  expect(sheet.legs["2:0>1"]!.lossSource).toMatchObject({ kind: "rule" });
  expect(sheet.legs["2:0>1"]!.lossSource.ref).toMatch(/^elbow-15d-45-le10 CD3-3 Co=/);
  expect(sheet.fittings.find((f) => f.key === "4")).toEqual(before);
});

it("a typed table swaps what a matched rule reads and says so", () => {
  const base = sheetWith();
  const sheet = sheetWith({ choices: { "elbow-1d-le10": "CD3-21" } });
  const row = sheet.fittings.find((f) => f.key === "4")!;
  expect(row).toMatchObject({ rule: "elbow-1d-le10", table: "CD3-21", ruleSource: "matched", tableSource: "typed" });
  expect(row.options).toContain("CD3-2");
  expect(row.lossInWg).not.toBeCloseTo(base.fittings.find((f) => f.key === "4")!.lossInWg!, 6);
});

it("the resolver reads Work's ruleAssignments and per-path proposed drops with a typed source", () => {
  const inputs = resolveInputs({
    snapshot: network,
    firm: TEST_FIRM,
    work: {
      ruleAssignments: { "Round Elbow": { rule: "elbow-15d-45-le10" } },
      assumptions: {
        "component-drop:proposed:1:1|2:0>7": { kind: "component-drop", inWg: 0.04 },
        "component-drop:Damper": { kind: "component-drop", inWg: 0.1 },
      },
    },
  });
  expect(inputs.assignments).toEqual({ "Round Elbow": { value: "elbow-15d-45-le10", source: "typed" } });
  expect(inputs.fittingDrops).toEqual({ "proposed:1:1|2:0>7": { value: 0.04, source: "typed" } });
});

it("a fitting whose flow is unknown stays in the census, unpriced under the rule it matches", () => {
  // No terminal or unit flow anywhere: every leg's flow is unknown (cloud Chadds MUAS-1 at r22
  // listed 1 fitting of 44 after two kind rulings made its flows unknown, 2026-10-30).
  const sheet = buildSheet({
    snapshot: network,
    fan: { unitId: 100, portIndex: 0 },
    roster,
    grids,
    inputs: inputsFor(network, { drops: { 6: 0.03, 10: 0.03 } }),
  });
  expect(sheet.blockers.some((b) => b.kind === "no-flow")).toBe(true);
  expect(sheet.fittings.map((f) => f.key).sort()).toEqual(["2", "4"]);
  expect(sheet.fittings.find((f) => f.key === "4")).toMatchObject({
    rule: "elbow-1d-le10",
    table: "CD3-2",
    ruleSource: "matched",
    lossInWg: null,
    unpriced: "its flow is unknown",
  });
  // Withheld by the path's no-flow blockers, never a not-priced blocker of its own.
  expect(sheet.blockers.filter((b) => b.kind === "not-priced")).toEqual([]);
});
