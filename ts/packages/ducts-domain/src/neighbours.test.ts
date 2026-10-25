/**
 * One ERV (100) roots four single-duct-run networks, one per port: supply out (gS, SA 1), fresh air
 * in (gF, FA 1), exhaust in from the house (gR, EX 1) and exhaust out (gE, EX 2). Opening SA 1, the
 * fresh-air side is the same airstream; the exhaust sides are the other one, through the core.
 */
import { expect, it } from "vite-plus/test";

import { neighboursOf } from "./neighbours.ts";
import type { DuctSnapshot } from "./types.ts";

type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

const conn = (index: number, classification: string, to: [number, number] | null): Connector => ({
  index,
  kind: "end",
  point: [0, 0, 0],
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  direction: "bidirectional",
  classification,
  connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
});
/** A straight run of ducts in one group, the first on the unit's `port`. */
const run = (
  group: string,
  system: string,
  cls: string,
  port: number,
  ids: number[],
  ft: number[],
) =>
  ids.map(
    (id, k): Segment => ({
      id,
      kind: "duct",
      curveKind: "line",
      shape: "round",
      size: '6"ø',
      diameterIn: 6,
      lengthFt: ft[k]!,
      polyline: [],
      groupId: group,
      systemName: system,
      roughness: { valueFt: 0.0003, provenance: "revit-default" },
      revit: {},
      connectors: [
        conn(0, cls, k === 0 ? [100, port] : [ids[k - 1]!, 1]),
        conn(1, cls, k < ids.length - 1 ? [ids[k + 1]!, 0] : null),
      ],
    }),
  );
const group = (id: string, system: string) => ({
  id,
  rootIds: [100],
  classifications: [],
  systemNames: [system],
  terminalCount: 0,
  elementCount: 0,
  loops: 0,
  issueIds: [],
});

const snapshot = {
  groups: [group("gS", "SA 1"), group("gF", "FA 1"), group("gR", "EX 1"), group("gE", "EX 2")],
  nodes: [
    {
      id: 100,
      kind: "equipment",
      category: "equipment",
      family: "ERV",
      point: [0, 0, 0],
      groupId: null,
      systemName: null,
      connectors: [
        conn(0, "SupplyAir", [1, 0]),
        conn(1, "SupplyAir", [11, 0]),
        conn(2, "ExhaustAir", [21, 0]),
        conn(3, "ExhaustAir", [31, 0]),
      ],
      facts: [],
    },
  ],
  segments: [
    ...run("gS", "SA 1", "SupplyAir", 0, [1, 2], [5, 5]),
    ...run("gF", "FA 1", "SupplyAir", 1, [11, 12, 13], [4, 4, 4]),
    ...run("gR", "EX 1", "ExhaustAir", 2, [21, 22], [3, 3]),
    // A 30 ft duct on the port: the stub is that one element, however long.
    ...run("gE", "EX 2", "ExhaustAir", 3, [31, 32], [30, 2]),
  ],
  flows: [],
  issues: [],
  levels: [],
  systems: [],
} as unknown as DuctSnapshot;

it("keeps to the open port's airstream by default", () => {
  expect(neighboursOf(snapshot, ["gS"], { stubFt: 10, hop: "same-classification" })).toEqual([
    { group: "gF", unit: 100, systems: ["FA 1"], stub: [11, 12] },
  ]);
});

it("hop all crosses the core, and a long element on the port is the whole stub", () => {
  const found = neighboursOf(snapshot, ["gS"], { stubFt: 10, hop: "all" });
  expect(found.map((n) => [n.group, n.stub])).toEqual([
    ["gF", [11, 12]],
    ["gR", [21, 22]],
    ["gE", [31]],
  ]);
});

it("an open group is never a neighbour, and stubFt bounds the stub", () => {
  const found = neighboursOf(snapshot, ["gS", "gF"], { stubFt: 4, hop: "all" });
  expect(found.map((n) => [n.group, n.stub])).toEqual([
    ["gR", [21]],
    ["gE", [31]],
  ]);
  expect(neighboursOf(snapshot, [], { stubFt: 10, hop: "all" })).toEqual([]);
});

it("caps neighbouring groups per unit after filtering, without changing open groups", () => {
  expect(
    neighboursOf(snapshot, ["gS"], { stubFt: 10, hop: "all", neighbourCap: 1 }).map((n) => n.group),
  ).toEqual(["gF"]);
  expect(neighboursOf(snapshot, ["gS"], { stubFt: 10, hop: "all", neighbourCap: 0 })).toEqual([]);
});

it("unknown connector classifications cannot establish a common airstream", () => {
  const unknown = {
    ...snapshot,
    nodes: snapshot.nodes.map((n) => ({
      ...n,
      connectors: n.connectors.map((c) => ({ ...c, classification: null })),
    })),
  };
  expect(neighboursOf(unknown, ["gS"], { stubFt: 10, hop: "same-classification" })).toEqual([]);
  expect(neighboursOf(unknown, ["gS"], { stubFt: 10, hop: "all" })).toHaveLength(3);
});
