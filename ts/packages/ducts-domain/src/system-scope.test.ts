/**
 * The subject is a Revit system: it spans every group it is in, a group carrying several systems is
 * shared, and only the runs from a fan to the system's terminals (plus its own elements and the
 * units feeding them) price it. One AHU feeds a tee; one branch is SA 1, the other RA 1; a second,
 * fanless network is SA 1 alone.
 */
import { expect, it } from "vite-plus/test";

import { NO_SYSTEM, sectionNames, systemScope, systemsOf } from "./system-scope.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

const conn = (index: number, x: number, to: [number, number] | null): Connector => ({
  index,
  kind: "end",
  point: [x, 0, 0],
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  direction: "bidirectional",
  classification: "SupplyAir",
  connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
});
const duct = (id: number, group: string, system: string, ends: Connector[]): Segment => ({
  id,
  kind: "duct",
  curveKind: "line",
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  lengthFt: 1,
  polyline: ends.map((c) => c.point),
  levelId: 1,
  groupId: group,
  systemName: system,
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: ends,
});
const node = (
  id: number,
  kind: Node["kind"],
  group: string | null,
  system: string | null,
  connectors: Connector[],
  mark?: string,
): Node => ({
  id,
  kind,
  category: kind,
  family: kind === "equipment" ? "AHU" : kind,
  point: connectors[0]!.point,
  groupId: group,
  systemName: system,
  connectors,
  facts: mark ? [{ key: "mark", text: mark, unit: "", provenance: "designer-stated" as const }] : [],
});

const snapshot = {
  groups: [
    {
      id: "g1",
      rootIds: [100],
      classifications: ["Supply Air", "Return Air"],
      systemNames: ["RA 1", "SA 1"],
      terminalCount: 2,
      elementCount: 6,
      loops: 0,
      issueIds: [],
    },
    {
      id: "g6",
      rootIds: [],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 1,
      elementCount: 2,
      loops: 0,
      issueIds: [],
    },
    {
      id: "g9",
      rootIds: [],
      classifications: [],
      systemNames: [],
      terminalCount: 0,
      elementCount: 1,
      loops: 0,
      issueIds: [],
    },
  ],
  nodes: [
    node(100, "equipment", null, "SA 1", [conn(0, 0, [1, 0])], "AHU-1"),
    node(3, "fitting", "g1", "SA 1", [conn(0, 2, [1, 1]), conn(1, 2, [4, 0]), conn(2, 2, [5, 0])]),
    node(10, "terminal", "g1", "SA 1", [conn(0, 4, [4, 1])]),
    node(20, "terminal", "g1", "RA 1", [conn(0, 4, [5, 1])]),
    node(11, "terminal", "g6", "SA 1", [conn(0, 9, [6, 1])]),
  ],
  segments: [
    duct(1, "g1", "SA 1", [conn(0, 0, [100, 0]), conn(1, 2, [3, 0])]),
    duct(4, "g1", "SA 1", [conn(0, 2, [3, 1]), conn(1, 4, [10, 0])]),
    duct(5, "g1", "RA 1", [conn(0, 2, [3, 2]), conn(1, 4, [20, 0])]),
    duct(6, "g6", "SA 1", [conn(0, 8, null), conn(1, 9, [11, 0])]),
    duct(7, "g9", "", [conn(0, 20, null), conn(1, 21, null)]),
  ],
  systems: [
    { id: 1, name: "SA 1", classification: "Supply Air", criticalPath: [], sections: [] },
    { id: 2, name: "RA 1", classification: "Return Air", criticalPath: [], sections: [] },
  ],
  flows: [],
  issues: [],
  levels: [],
} as unknown as DuctSnapshot;

it("a system spans every group it is in; a group of several systems is shared", () => {
  const sa = systemScope(snapshot, "SA 1");
  expect(sa.groups).toEqual(["g1", "g6"]);
  expect(sa.shared.get("g1")).toEqual(["RA 1"]);
  expect(sa.shared.has("g6")).toBe(false);
  expect([...sa.terminals].sort()).toEqual([10, 11]);
  expect(systemScope(snapshot, "RA 1").groups).toEqual(["g1"]);
});

it("only the runs to the system's own terminals, its elements and their unit price it", () => {
  const sa = systemScope(snapshot, "SA 1");
  expect([...sa.prices].sort((a, b) => a - b)).toEqual([1, 3, 4, 6, 10, 11, 100]);
  expect(sa.prices.has(5)).toBe(false);
  expect(sa.prices.has(20)).toBe(false);
  expect(sa.members.has(20)).toBe(true);
  expect([...sa.units]).toEqual([100]);
  const ra = systemScope(snapshot, "RA 1");
  // RA 1's run leaves the AHU through SA 1's trunk: the shared trunk prices both.
  expect([...ra.prices].sort((a, b) => a - b)).toEqual([1, 3, 5, 20, 100]);
});

it("the picker lists systems by name with classification and unit tags, unclaimed groups last", () => {
  const list = systemsOf(snapshot);
  expect(list.map((s) => s.name)).toEqual(["RA 1", "SA 1", NO_SYSTEM]);
  expect(list[1]).toMatchObject({
    classification: "Supply Air",
    groups: ["g1", "g6"],
    units: ["AHU-1"],
    terminals: 2,
  });
});

it("a system's sections are named by the system and the units rooting them, never a group id", () => {
  expect([...sectionNames(snapshot, "SA 1").values()]).toEqual(["SA 1 · AHU-1", "SA 1 · no fan"]);
});
