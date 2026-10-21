import { expect, it } from "vite-plus/test";

import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { fanOutWords, flowSourceWord, groupLabels, ruleFanOut } from "./inputs";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Node["connectors"][number];

const port = (index: number, to: { elementId: number; connector: number } | null): Connector =>
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
    areaFt2: 0.7854,
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
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors,
  }) as unknown as Segment;
const group = (id: string, rootIds: number[], systemNames: string[]) => ({
  id,
  rootIds,
  classifications: ["Supply Air"],
  systemNames,
  terminalCount: 0,
  elementCount: 0,
  loops: 0,
  issueIds: [],
});
const mark = (text: string) => ({ key: "mark", text, unit: "", provenance: "revit" });

/**
 * Unit 1 feeds duct 10, which taps duct 11; terminals 30 and 31 hang off them (group g10).
 * Unit 2 feeds duct 12 to terminal 32 (group g12). A damper-like instance sits on 11 (only 31 is
 * downstream of it), another on 10 (both are), and one on 12.
 */
const snapshot = {
  document: { title: "t", readAt: "", elapsedMs: 0, networkBasedCalculations: true },
  coordinateEncoding: "native-double",
  levels: [],
  groups: [group("g10", [1], ["SA 19"]), group("g12", [2], ["SA 19"])],
  nodes: [
    node(1, "equipment", null, [port(1, { elementId: 10, connector: 1 })], [mark("FC-17") as never]),
    node(2, "equipment", null, [port(1, { elementId: 12, connector: 1 })], [mark("FC-18") as never]),
    node(30, "terminal", "g10", [port(1, { elementId: 10, connector: 2 })]),
    node(31, "terminal", "g10", [port(1, { elementId: 11, connector: 2 })]),
    node(32, "terminal", "g12", [port(1, { elementId: 12, connector: 2 })]),
  ],
  segments: [
    duct(10, "g10", [
      port(1, { elementId: 1, connector: 1 }),
      port(2, { elementId: 30, connector: 1 }),
      port(3, { elementId: 11, connector: 1 }),
    ]),
    duct(11, "g10", [port(1, { elementId: 10, connector: 3 }), port(2, { elementId: 31, connector: 1 })]),
    duct(12, "g12", [port(1, { elementId: 2, connector: 1 }), port(2, { elementId: 32, connector: 1 })]),
  ],
  flows: [],
  issues: [],
  layers: [],
  systems: [],
  slots: {},
} as unknown as DuctSnapshot;

it("a rule's fan-out counts the grilles downstream of its instances and the systems they sit in", () => {
  expect(ruleFanOut(snapshot, new Map([[11, "elbow"]]), "elbow")).toEqual({ grilles: 1, systems: 1 });
  expect(ruleFanOut(snapshot, new Map([[10, "elbow"]]), "elbow")).toEqual({ grilles: 2, systems: 1 });
  expect(
    ruleFanOut(
      snapshot,
      new Map([
        [11, "elbow"],
        [12, "elbow"],
        [10, "other"],
      ]),
      "elbow",
    ),
  ).toEqual({ grilles: 2, systems: 2 });
  expect(ruleFanOut(snapshot, new Map(), "elbow")).toEqual({ grilles: 0, systems: 0 });
  expect(fanOutWords({ grilles: 2, systems: 2 })).toBe("moves 2 grilles in 2 systems");
  expect(fanOutWords({ grilles: 1, systems: 1 })).toBe("moves 1 grille in 1 system");
});

it("groups of one system name are told apart by their root units", () => {
  const labels = groupLabels(snapshot);
  expect(labels.get("g10")).toBe("SA 19 · FC-17");
  expect(labels.get("g12")).toBe("SA 19 · FC-18");
  // Two groups that would read alike are numbered, never told apart by an id.
  const twins = {
    ...snapshot,
    groups: [group("ga", [], ["SA 1"]), group("gb", [], ["SA 1"])],
  } as unknown as DuctSnapshot;
  expect(groupLabels(twins).get("ga")).toBe("SA 1 · no air mover");
  expect(groupLabels(twins).get("gb")).toBe("SA 1 · no air mover 2");
});

it("flow sources read as the rung's word", () => {
  expect(flowSourceWord("override")).toBe("override");
  expect(flowSourceWord("revit")).toBe("Revit");
  expect(flowSourceWord("rooms:Office")).toBe("rooms");
  expect(flowSourceWord("load-preview:FC-4")).toBe("load preview");
  expect(flowSourceWord(null)).toBeNull();
});
