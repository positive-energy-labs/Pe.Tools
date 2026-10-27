/**
 * Phase anomalies, deterministic (kaitpw 2026-10-19): with a working phase, elements that do not
 * exist in it leave the network, and each one that touched a kept element is an `out-of-phase`
 * warning a person rules on; with none, nothing changes. Snapshots are built in proximity.test.ts's
 * shape: model feet, one group per groupId.
 */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema, workingPhaseOf } from "@pe/agent-contracts";

import { phased } from "./phases.ts";
import { survey, tolerated } from "./survey.ts";
import type { DuctSnapshot } from "./types.ts";

type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

const ORDER = ["Existing", "New Construction", "Future"];
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
});
const duct = (
  id: number,
  a: number[],
  b: number[],
  groupId: string,
  phaseCreated = "Existing",
): Segment => ({
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
  phaseCreated,
});
const link = (a: Segment, ia: number, b: Segment, ib: number) => {
  a.connectors.find((c) => c.index === ia)!.connectedTo = { elementId: b.id, connector: ib };
  b.connectors.find((c) => c.index === ib)!.connectedTo = { elementId: a.id, connector: ia };
};
const snap = (segments: Segment[], order: string[] | null = ORDER): DuctSnapshot => {
  const groupIds = [...new Set(segments.map((s) => s.groupId!))];
  return {
    coordinateEncoding: "native-double",
    document: {
      title: "t",
      readAt: "2026-10-19T00:00:00Z",
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
      issueIds: [],
    })),
    nodes: [],
    segments,
    flows: segments.map((s) => ({ segmentId: s.id, cfm: 100, provenance: "derived" as const })),
    issues: [],
    layers: [],
    systems: [],
    slots: {
      fanStatic: "",
      fanFlow: "",
      componentDrop: "",
      fittingCoefficient: "",
      terminalFlow: "",
    },
    ...(order
      ? { phases: { order, views: [{ phase: "Existing", filter: "Show All", count: 12 }] } }
      : {}),
  };
};
const working = (phase: string | null, rung: "edit" | "suggestion" = "edit") =>
  ductsDocumentSchema.parse({ workingPhase: { [rung]: { value: phase } } });

/** Project A's shape: Existing run 1 -> 2; Future duct 3 joined to 2's end and lying inside duct 4. */
const projectA = () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0], "g1");
  const b = duct(2, [10, 0, 0], [20, 0, 0], "g1");
  const host = duct(4, [30, 0, 0], [40, 0, 0], "g4");
  const junk = duct(3, [20, 0, 0], [35, 0, 0], "g1", "Future");
  link(a, 2, b, 1);
  link(b, 2, junk, 1);
  return snap([a, b, junk, host]);
};

it("an element not in the working phase leaves the network and warns, naming its phase and what it touches", () => {
  const before = projectA();
  const { snapshot, findings } = phased(before, working("Existing"));
  expect(snapshot.segments.map((s) => s.id)).toEqual([1, 2, 4]);
  expect(snapshot.segments[1]!.connectors[1]!.connectedTo).toBeNull();
  expect(snapshot.flows.map((f) => f.segmentId)).toEqual([1, 2, 4]);
  expect(snapshot.groups.map((g) => [g.id, g.elementCount])).toEqual([
    ["g1", 2],
    ["g4", 1],
  ]);
  expect(findings).toEqual([
    {
      id: "out-of-phase:3",
      kind: "out-of-phase",
      elementIds: [3, 2, 4],
      note: "duct is created in Future, so it does not exist in working phase Existing; left out of the network, though it connects to 2, meets 4 by proximity and sits inside 4",
      grade: null,
    },
  ]);
  // In Future it exists: nothing is left out.
  expect(phased(before, working("Future")).findings).toEqual([]);
  // The input is untouched.
  expect(before.segments).toHaveLength(4);
});

it("a demolished element, and one only proximity would join, warn too; one touching nothing is left out silently", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0], "g1");
  const near = duct(2, [10 + 0.4 / 12, 0, 0], [20, 0, 0], "g2", "Existing");
  near.phaseDemolished = "New Construction";
  const far = duct(5, [100, 0, 0], [110, 0, 0], "g5", "Future");
  const { snapshot, findings } = phased(snap([a, near, far]), working("New Construction"));
  expect(snapshot.segments.map((s) => s.id)).toEqual([1]);
  expect(findings).toEqual([
    {
      id: "out-of-phase:2",
      kind: "out-of-phase",
      elementIds: [2, 1],
      note: "duct is demolished in New Construction, so it does not exist in working phase New Construction; left out of the network, though it meets 1 by proximity",
      grade: null,
    },
  ]);
});

it("the route reads the edit working phase, else Pea's suggestion; a person's edit null reads every element", () => {
  expect(workingPhaseOf(working("Existing", "suggestion"))).toBe("Existing");
  const both = ductsDocumentSchema.parse({
    workingPhase: { suggestion: { value: "Future" }, edit: { value: null } },
  });
  expect(workingPhaseOf(both)).toBeNull();
  const before = projectA();
  // Proximity never sees the left-out duct: no inference joins duct 2's freed end to it.
  const t = tolerated(before, working("Existing", "suggestion"));
  expect(t.snapshot.segments.map((s) => s.id)).toEqual([1, 2, 4]);
  expect(t.findings.map((f) => f.id)).toEqual(["out-of-phase:3"]);
  // With no working phase the Future duct is in the network: duct 4's end, inside it, taps it.
  const all = tolerated(before, null);
  expect(all.findings.map((f) => [f.id, f.kind])).toEqual([
    ["proximity:4:1|3", "tap-by-proximity"],
  ]);
  const finding = survey(before, working("Existing")).findings.find(
    (f) => f.id === "out-of-phase:3",
  );
  expect(finding).toMatchObject({
    kind: "out-of-phase",
    clearer: "person",
    assumed: expect.stringContaining("left out"),
  });
});
