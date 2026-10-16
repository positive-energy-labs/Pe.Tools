/**
 * Proximity inference, deterministic: a small gap joins, a wide one does not, a branch end near a
 * main's interior taps it, a staged ignore verdict withholds the inference, and an inference that
 * closes a ring is also a loop finding. Points are model feet; the tolerance is inches.
 */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema, type DuctsRouteDocument } from "@pe/agent-contracts";

import { inferJoints, tolerate } from "./proximity.ts";
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

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
const duct = (id: number, a: number[], b: number[], groupId = "g1"): Segment => ({
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
  groupId,
  systemName: "SA 1",
  classification: "Supply Air",
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [conn(1, a), conn(2, b)],
  uniqueId: null,
});
const link = (a: Segment, ia: number, b: Segment, ib: number) => {
  a.connectors.find((c) => c.index === ia)!.connectedTo = { elementId: b.id, connector: ib };
  b.connectors.find((c) => c.index === ib)!.connectedTo = { elementId: a.id, connector: ia };
};
/** A snapshot of ducts only, with an open-end issue per open connector and one group per groupId. */
const snap = (segments: Segment[]): DuctSnapshot => {
  const issues = segments.flatMap((s) =>
    s.connectors
      .filter((c) => !c.connectedTo)
      .map((c) => ({
        id: `open-end:${s.groupId}:${s.id}:${c.index}`,
        kind: "open-end" as const,
        elementId: s.id,
        point: c.point,
        groupId: s.groupId!,
        note: "open",
      })),
  );
  const groupIds = [...new Set(segments.map((s) => s.groupId!))];
  return {
    coordinateEncoding: "native-double",
    document: {
      title: "t",
      readAt: "2026-10-16T00:00:00Z",
      elapsedMs: 1,
      networkBasedCalculations: true,
    },
    levels: [],
    groups: groupIds.map((id) => ({
      id,
      rootIds: [],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 0,
      elementCount: segments.filter((s) => s.groupId === id).length,
      loops: 0,
      issueIds: issues.filter((i) => i.groupId === id).map((i) => i.id),
    })),
    nodes: [],
    segments,
    flows: [],
    issues,
    layers: [],
    systems: [],
    slots: { fanStatic: "", fanFlow: "", componentDrop: "", fittingCoefficient: "" },
  };
};
const ignoring = (id: string): DuctsRouteDocument =>
  ductsDocumentSchema.parse({
    assumptions: { [id]: { staged: { value: { kind: "verdict", verdict: "ignore" } } } },
  });

it("a 0.4 in gap joins the two open ends and merges their groups", () => {
  const before = snap([
    duct(1, [0, 0, 0], [10, 0, 0], "g1"),
    duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0], "g2"),
  ]);
  const { joints, taps, findings, snapshot } = tolerate(before);
  expect(joints).toEqual([
    { a: "1:2", b: "2:1", kind: "joined-by-proximity", gapIn: expect.closeTo(0.4, 6) },
  ]);
  expect(taps).toEqual([]);
  expect(findings.map((f) => f.id)).toEqual(["proximity:1:2|2:1"]);
  expect(snapshot.segments[0]!.connectors[1]!.connectedTo).toEqual({ elementId: 2, connector: 1 });
  expect(snapshot.segments[1]!.connectors[0]!.connectedTo).toEqual({ elementId: 1, connector: 2 });
  // An absorbed group's issue ids keep their prefix: a verdict cell is keyed on the id as read.
  expect(snapshot.issues.map((i) => [i.id, i.groupId])).toEqual([
    ["open-end:g1:1:1", "g1"],
    ["open-end:g2:2:2", "g1"],
  ]);
  expect(snapshot.groups.map((g) => [g.id, g.elementCount, g.issueIds])).toEqual([
    ["g1", 2, ["open-end:g1:1:1", "open-end:g2:2:2"]],
  ]);
  expect(groupTree(snapshot, "g1").parent.get(2)).toBe(1);
  // The input is untouched.
  expect(before.segments[0]!.connectors[1]!.connectedTo).toBeNull();
  expect(before.groups).toHaveLength(2);
});

it("a 2 in gap stays open", () => {
  const before = snap([duct(1, [0, 0, 0], [10, 0, 0]), duct(2, [10 + 2 * IN, 0, 0], [20, 0, 0])]);
  expect(inferJoints(before)).toEqual({ joints: [], taps: [], findings: [] });
  expect(tolerate(before).snapshot).toBe(before);
});

it("a branch end 0.3 in from a main's interior becomes a virtual tap on the main", () => {
  const before = snap([
    duct(1, [0, 0, 0], [20, 0, 0], "g1"),
    duct(2, [10, 0.3 * IN, 0], [10, 10, 0], "g2"),
  ]);
  const { joints, taps, snapshot } = tolerate(before);
  expect(joints).toEqual([]);
  expect(taps).toEqual([
    {
      a: "2:1",
      segment: 1,
      kind: "tap-by-proximity",
      gapIn: expect.closeTo(0.3, 6),
      at: expect.closeTo(10, 6),
    },
  ]);
  const tap = snapshot.nodes[0]!;
  expect(tap).toMatchObject({
    id: -1,
    kind: "fitting",
    partType: "Tap",
    groupId: "g1",
    point: [10, 0, 0],
  });
  const main = snapshot.segments[0]!;
  expect(main.connectors[2]).toMatchObject({
    index: 3,
    kind: "curve",
    point: [10, 0, 0],
    connectedTo: { elementId: -1, connector: 0 },
  });
  expect(snapshot.segments[1]!.connectors[0]!.connectedTo).toEqual({ elementId: -1, connector: 1 });
  expect(snapshot.issues.map((i) => i.id)).toEqual([
    "open-end:g1:1:1",
    "open-end:g1:1:2",
    "open-end:g2:2:2",
  ]);
  expect(snapshot.groups.map((g) => [g.id, g.elementCount])).toEqual([["g1", 3]]);
  const tree = groupTree(snapshot, "g1");
  expect(tree.parent.get(-1)).toBe(1);
  expect(tree.parent.get(2)).toBe(-1);
});

it("a staged ignore verdict on the finding id withholds that inference", () => {
  const before = snap([
    duct(1, [0, 0, 0], [10, 0, 0], "g1"),
    duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0], "g2"),
  ]);
  const out = tolerate(before, ignoring("proximity:1:2|2:1"));
  expect(out.joints).toEqual([]);
  expect(out.snapshot).toBe(before);
  expect(out.snapshot.issues.map((i) => i.id)).toContain("open-end:g1:1:2");
});

it("an inferred joint that closes a ring is also a loop-by-inference finding", () => {
  const d1 = duct(1, [0, 0, 0], [10, 0, 0]);
  const d2 = duct(2, [10, 0, 0], [10, 10, 0]);
  const d3 = duct(3, [10, 10, 0], [0, 10, 0]);
  const d4 = duct(4, [0, 10, 0], [0, 0.4 * IN, 0]);
  link(d1, 2, d2, 1);
  link(d2, 2, d3, 1);
  link(d3, 2, d4, 1);
  const { joints, findings, snapshot } = tolerate(snap([d1, d2, d3, d4]));
  expect(joints).toEqual([
    { a: "1:1", b: "4:2", kind: "joined-by-proximity", gapIn: expect.closeTo(0.4, 6) },
  ]);
  expect(findings.map((f) => [f.id, f.kind])).toEqual([
    ["proximity:1:1|4:2", "joined-by-proximity"],
    ["loop-by-inference:1:1|4:2", "loop-by-inference"],
  ]);
  expect(groupTree(snapshot, "g1").backEdges).toHaveLength(1);
});
