import { describe, expect, it } from "vite-plus/test";

import { terminalFlows } from "./terminal-flows.ts";
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Node["connectors"][number];

const port = (
  index: number,
  to: { elementId: number; connector: number } | null,
  areaFt2: number | null = 0.7854,
): Connector =>
  ({
    index,
    kind: "end",
    point: [0, 0, 9],
    shape: "round",
    size: '12"ø',
    diameterIn: 12,
    direction: "bidirectional",
    classification: "SupplyAir",
    connectedTo: to,
    areaFt2,
  }) as Connector;
const node = (
  id: number,
  kind: string,
  groupId: string | null,
  connectors: Connector[],
  facts: Node["facts"] = [],
): Node =>
  ({
    id,
    kind,
    category: kind,
    family: kind,
    type: "Standard",
    levelId: 100,
    point: [0, 0, 9],
    groupId,
    systemName: "SA",
    classification: "Supply Air",
    connectors,
    facts,
  }) as unknown as Node;
const duct = (id: number, groupId: string, connectors: Connector[]): Segment =>
  ({
    id,
    kind: "duct",
    curveKind: "line",
    type: "Round Duct",
    shape: "round",
    size: '12"ø',
    diameterIn: 12,
    lengthFt: 10,
    polyline: [
      [0, 0, 9],
      [10, 0, 9],
    ],
    levelId: 100,
    groupId,
    systemName: "SA",
    classification: "Supply Air",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors,
  }) as unknown as Segment;
const mark = (text: string): Node["facts"][number] =>
  ({ key: "mark", text, unit: "", provenance: "revit" }) as unknown as Node["facts"][number];
const flow = (value: number): Node["facts"][number] =>
  ({ key: "flow", value, unit: "cfm", provenance: "revit" }) as unknown as Node["facts"][number];

/**
 * Equipment 1 (FC-4) feeds duct 10, which taps duct 11; terminals 30 (12"ø) and 31 hang off them.
 * Equipment 2 (FC-7) feeds duct 12 and nothing else. Equipment 3 (FC-99) is in no system.
 * Terminals 40 (Revit flow 120) and 41 (no flow) sit in group g40 with no equipment.
 */
const snapshot = (area31: number | null): DuctSnapshot =>
  ({
    document: { title: "t", readAt: "", elapsedMs: 0, networkBasedCalculations: true },
    coordinateEncoding: "native-double",
    levels: [],
    groups: [
      {
        id: "g10",
        rootIds: [1],
        classifications: [],
        systemNames: [],
        terminalCount: 2,
        elementCount: 4,
        loops: 0,
        issueIds: [],
      },
      {
        id: "g12",
        rootIds: [2],
        classifications: [],
        systemNames: [],
        terminalCount: 0,
        elementCount: 1,
        loops: 0,
        issueIds: [],
      },
      {
        id: "g40",
        rootIds: [],
        classifications: [],
        systemNames: [],
        terminalCount: 2,
        elementCount: 3,
        loops: 0,
        issueIds: [],
      },
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
    flows: [],
    issues: [],
    layers: [],
    systems: [],
    slots: {},
  }) as unknown as DuctSnapshot;

const loads = {
  systems: [
    { name: "System 1 Golf FC-4", tag: "FC-4", cfm: 600, rooms: [] },
    { name: "System 2 Bar FC-7", tag: "FC-7", cfm: 400, rooms: [] },
    { name: "System 3 Theater FC-10", tag: "FC-10", cfm: 300, rooms: [] },
    { name: "System 4 Loft", tag: null, cfm: 200, rooms: [] },
  ],
};
const trees = (s: DuctSnapshot) => s.groups.map((g) => groupTree(s, g.id));
const run = (area31: number | null, staged = {}) => {
  const s = snapshot(area31);
  const { flows, findings } = terminalFlows(s, loads, staged, trees(s));
  return { flows: Object.fromEntries(flows), findings };
};

describe("terminalFlows", () => {
  it("splits the tagged system's flow by neck area and falls back to Revit", () => {
    const { flows, findings } = run(0.7854 / 3);
    expect(flows[30]!.source).toBe("load-preview:FC-4");
    expect(flows[30]!.cfm).toBeCloseTo(450);
    expect(flows[31]!.cfm).toBeCloseTo(150);
    expect(flows[40]).toEqual({ cfm: 120, source: "revit" });
    expect(flows[41]).toEqual({ cfm: null, source: null, finding: "no-flow" });
    expect(findings).toEqual([
      { kind: "no-terminals", mark: "FC-7", equipment: 2 },
      { kind: "tag-without-mark", tag: "FC-10", system: "System 3 Theater FC-10" },
      { kind: "mark-without-system", mark: "FC-99", equipment: 3 },
      { kind: "no-flow", terminal: 41 },
    ]);
  });

  it("splits evenly when any terminal has no area", () => {
    const { flows } = run(null);
    expect(flows[30]!.cfm).toBe(300);
    expect(flows[31]!.cfm).toBe(300);
  });

  it("names a markless unit that feeds terminals, only once loads exist", () => {
    const s = snapshot(0.7854);
    s.nodes.find((n) => n.id === 1)!.facts = [];
    const withLoads = terminalFlows(s, loads, {}, trees(s)).findings;
    expect(withLoads).toContainEqual({
      kind: "no-mark",
      equipment: 1,
      label: "equipment / Standard",
    });
    expect(withLoads).not.toContainEqual(
      expect.objectContaining({ kind: "no-mark", equipment: 2 }),
    );
    expect(terminalFlows(s, null, {}, trees(s)).findings).not.toContainEqual(
      expect.objectContaining({ kind: "no-mark" }),
    );
  });

  it("lets a staged flow override every other source", () => {
    const { flows } = run(0.7854, { "31": { cfm: 150, source: "balancing report" } });
    expect(flows[31]).toEqual({ cfm: 150, source: "override" });
    expect(flows[30]).toEqual({ cfm: 300, source: "load-preview:FC-4" });
  });
});
