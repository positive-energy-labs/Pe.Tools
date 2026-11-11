import { describe, expect, it } from "vite-plus/test";

import { bin } from "./bins.ts";

import { computeLosses } from "./losses.ts";
import { survey } from "./survey.ts";
import { terminalFlows } from "./terminal-flows.ts";
import { designOf } from "./test-design.ts";
import {
  connOf,
  ductOf,
  factOf,
  groupOf,
  nodeOf,
  round,
  snapshotOf,
  systemOf,
  type Connector,
  type Node,
} from "./test-snapshot.ts";
import type { DuctSnapshot } from "./types.ts";

const port = (
  index: number,
  to: { elementId: number; connector: number } | null,
  areaFt2: number | null = 0.7854,
) =>
  connOf(index, to && [to.elementId, to.connector], {
    ...round(12),
    point: [0, 0, 9],
    classification: "SupplyAir",
    areaFt2,
  });
const node = (
  id: number,
  kind: Node["kind"],
  groupId: string | null,
  connectors: Connector[],
  facts: Node["facts"] = [],
) =>
  nodeOf(id, kind, {
    family: kind,
    type: "Standard",
    levelId: 100,
    point: [0, 0, 9],
    groupId,
    systemName: "SA",
    classification: "Supply Air",
    connectors,
    facts,
  });
const duct = (id: number, groupId: string, connectors: Connector[]) =>
  ductOf(id, {
    type: "Round Duct",
    ...round(12),
    lengthFt: 10,
    polyline: [
      [0, 0, 9],
      [10, 0, 9],
    ],
    levelId: 100,
    groupId,
    systemName: "SA",
    classification: "Supply Air",
    connectors,
  });
const mark = (text: string) => factOf("mark", text);
const flow = (value: number) => factOf("flow", value, { unit: "cfm" });

/**
 * Equipment 1 (FC-4) feeds duct 10, which taps duct 11; terminals 30 (12"ø) and 31 hang off them.
 * Equipment 2 (FC-7) feeds duct 12 and nothing else. Equipment 3 (FC-99) is in no system.
 * Terminals 40 (Revit flow 120) and 41 (no flow) sit in group g40 with no equipment.
 */
const snapshot = (area31: number | null): DuctSnapshot =>
  snapshotOf({
    groups: [
      groupOf("g10", { rootIds: [1], terminalCount: 2, elementCount: 4 }),
      groupOf("g12", { rootIds: [2], elementCount: 1 }),
      groupOf("g40", { terminalCount: 2, elementCount: 3 }),
    ],
    nodes: [
      node(1, "equipment", null, [port(1, { elementId: 10, connector: 1 })], [mark("FC-4")]),
      node(2, "equipment", null, [port(1, { elementId: 12, connector: 1 })], [mark("FC-7")]),
      node(3, "equipment", null, [], [mark("FC-99")]),
      node(30, "terminal", "g10", [port(1, { elementId: 10, connector: 2 }, 0.7854)]),
      node(31, "terminal", "g10", [port(1, { elementId: 11, connector: 2 }, area31)]),
      node(40, "terminal", "g40", [port(1, { elementId: 13, connector: 1 })], [flow(120)]),
      node(41, "terminal", "g40", [port(1, { elementId: 13, connector: 2 })]),
    ],
    segments: [
      duct(10, "g10", [
        port(1, { elementId: 1, connector: 1 }),
        port(2, { elementId: 30, connector: 1 }),
        port(3, { elementId: 11, connector: 1 }),
      ]),
      duct(11, "g10", [
        port(1, { elementId: 10, connector: 3 }),
        port(2, { elementId: 31, connector: 1 }),
      ]),
      duct(12, "g12", [port(1, { elementId: 2, connector: 1 }), port(2, null)]),
      duct(13, "g40", [
        port(1, { elementId: 40, connector: 1 }),
        port(2, { elementId: 41, connector: 1 }),
      ]),
    ],
  });

const run = (edit = {}) => {
  const { flows, findings } = terminalFlows(snapshot(0.7854), edit);
  return { flows: Object.fromEntries(flows), findings };
};

// FANSPLIT (kaitpw 2026-11-03): the Load Preview source is deleted, so its neck-area split, even
// split and tag/mark findings cases are gone; precedence is edit, then rooms, then Revit.
describe("terminalFlows", () => {
  it("falls back to Revit, and a terminal with no flow is a finding", () => {
    const { flows, findings } = run();
    expect(flows[30]).toEqual({ cfm: null, source: null, finding: "no-flow" });
    expect(flows[40]).toEqual({ cfm: 120, source: "revit" });
    expect(flows[41]).toEqual({ cfm: null, source: null, finding: "no-flow" });
    expect(findings).toEqual([
      { kind: "no-flow", terminal: 30 },
      { kind: "no-flow", terminal: 31 },
      { kind: "no-flow", terminal: 41 },
    ]);
  });

  it("takes an edit flow over Revit", () => {
    expect(run({ "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000028": { cfm: 90 } }).flows[40]).toEqual({ cfm: 90, source: "override" });
  });

  it("takes a rooms flow after an edit one and before Revit", () => {
    const s = snapshot(0.7854);
    const rooms = new Map([
      [30, { cfm: 111, source: "room 101" }],
      [31, { cfm: 222, source: "room 102" }],
      [40, { cfm: 333, source: "room 103" }],
    ]);
    const { flows } = terminalFlows(s, { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-0000001f": { cfm: 150 } }, rooms);
    expect(flows.get(31)).toEqual({ cfm: 150, source: "override" });
    expect(flows.get(30)).toEqual({ cfm: 111, source: "rooms:room 101" });
    expect(flows.get(40)).toEqual({ cfm: 333, source: "rooms:room 103" });
  });
});

describe("a group with no air mover", () => {
  it("prices nothing and raises one blocking no-fan finding; a edit passive root is no fan", () => {
    const s = snapshot(0.7854);
    // Units 1 and 2 are the base equipment of the systems their groups carry: proposed fans.
    s.groups[0]!.systemNames = ["SA 1"];
    s.groups[1]!.systemNames = ["SA 2"];
    s.systems = [
      systemOf(1, { name: "SA 1", baseEquipmentId: 1 }),
      systemOf(2, { name: "SA 2", baseEquipmentId: 2 }),
    ];
    const work = designOf({});
    const found = survey(s, work).findings.filter((f) => f.kind === "no-fan");
    expect(found.map((f) => f.groupId)).toEqual(["g40"]);
    expect(found[0]!.elementIds).toEqual([40, 41]);
    expect(bin(found[0]!)).toBe("blocking");
    const result = computeLosses(s, {});
    expect(result.byGroup.g40!.hasAirMover).toBe(false);
    expect(result.byGroup.g10!.hasAirMover).toBe(true);
    expect(result.paths[40]).toBeUndefined();
    expect(result.paths[30]).toBeDefined();
    // Staging unit 1 passive leaves g10 with no fan too.
    const passive = designOf({
      roles: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000001": { edit: { value: { role: "passive" } } } },
    });
    const again = survey(s, passive).findings.filter((f) => f.kind === "no-fan");
    expect(again.map((f) => f.groupId)).toEqual(["g10", "g40"]);
    expect(computeLosses(s, {}, {}, { unitRole: { 1: "passive" } }).byGroup.g10!.hasAirMover).toBe(
      false,
    );
  });
});
