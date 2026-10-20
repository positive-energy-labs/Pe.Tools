/**
 * Proximity inference, deterministic: a small gap joins, a wide one does not, a branch end landing
 * on a duct's face (a side, off-center or shared, or an end a cap closes) taps it, one alongside
 * does not, a staged ignore verdict withholds the inference, and an inference that closes a ring
 * is also a loop finding. Ends of different air classifications never join without a staged
 * connect verdict, an end anywhere inside a duct's body taps it, and every inference is a finding
 * a person clears (kaitpw 2026-10-19). Points are model feet; the tolerance is inches.
 */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema, type DuctsRouteDocument } from "@pe/agent-contracts";

import { CAP_THICKNESS_IN, inferJoints, tolerate } from "./proximity.ts";
import { survey } from "./survey.ts";
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

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
/** A rectangular duct `w` x `h` in. */
const rect = (id: number, a: number[], b: number[], w: number, h: number, groupId = "g1") => {
  const s = duct(id, a, b, groupId);
  const sized = { shape: "rectangular" as const, size: `${w}x${h}`, widthIn: w, heightIn: h };
  return {
    ...s,
    ...sized,
    diameterIn: null,
    connectors: s.connectors.map((c) => ({ ...c, ...sized, diameterIn: null })),
  };
};
/** An end cap on `on`'s connector `index`. */
const cap = (id: number, on: Segment, index: number): Node => {
  const end = on.connectors.find((c) => c.index === index)!;
  end.connectedTo = { elementId: id, connector: 1 };
  return {
    id,
    kind: "cap",
    category: "Duct Fittings",
    family: "Rectangular Endcap",
    type: null,
    partType: "Cap",
    levelId: 1,
    point: end.point,
    groupId: on.groupId,
    systemName: "SA 1",
    classification: "Supply Air",
    connectors: [{ ...end, index: 1, connectedTo: { elementId: on.id, connector: index } }],
    facts: [],
    uniqueId: null,
  };
};
const link = (a: Segment, ia: number, b: Segment, ib: number) => {
  a.connectors.find((c) => c.index === ia)!.connectedTo = { elementId: b.id, connector: ib };
  b.connectors.find((c) => c.index === ib)!.connectedTo = { elementId: a.id, connector: ia };
};
/** A snapshot of ducts only, with an open-end issue per open connector and one group per groupId. */
const snap = (segments: Segment[], nodes: Node[] = []): DuctSnapshot => {
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
  const groupIds = [...new Set([...segments, ...nodes].map((s) => s.groupId!))];
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
      elementCount: [...segments, ...nodes].filter((s) => s.groupId === id).length,
      loops: 0,
      issueIds: issues.filter((i) => i.groupId === id).map((i) => i.id),
    })),
    nodes,
    segments,
    flows: [],
    issues,
    layers: [],
    systems: [],
    slots: { fanStatic: "", fanFlow: "", componentDrop: "", fittingCoefficient: "" },
  };
};
const staging = (id: string, verdict: "ignore" | "connect"): DuctsRouteDocument =>
  ductsDocumentSchema.parse({
    assumptions: { [id]: { staged: { value: { kind: "verdict", verdict } } } },
  });
const ignoring = (id: string) => staging(id, "ignore");
/** `s` carried as return air, its ports too. */
const returnAir = <T extends Segment>(s: T): T => ({
  ...s,
  classification: "Return Air",
  systemName: "RA 1",
  connectors: s.connectors.map((c) => ({ ...c, classification: "ReturnAir" })),
});

it("a 0.4 in gap joins the two open ends and merges their groups", () => {
  const before = snap([
    duct(1, [0, 0, 0], [10, 0, 0], "g1"),
    duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0], "g2"),
  ]);
  const { joints, taps, findings, snapshot } = tolerate(before);
  expect(joints).toEqual([
    {
      id: "proximity:1:2|2:1",
      a: "1:2",
      b: "2:1",
      kind: "joined-by-proximity",
      gapIn: expect.closeTo(0.4, 6),
      grade: "near-miss",
    },
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

it("a 2.5 in gap stays open: past the 1 in end-to-end rule and past FACE_TOL_IN of either mouth", () => {
  const before = snap([duct(1, [0, 0, 0], [10, 0, 0]), duct(2, [10 + 2.5 * IN, 0, 0], [20, 0, 0])]);
  expect(inferJoints(before)).toEqual({ joints: [], taps: [], inline: [], findings: [] });
  expect(tolerate(before).snapshot).toBe(before);
});

it("a branch end 0.3 in off a main's side becomes a virtual tap on the main", () => {
  const before = snap([
    duct(1, [0, 0, 0], [20, 0, 0], "g1"),
    duct(2, [10, 3.3 * IN, 0], [10, 10, 0], "g2"),
  ]);
  const { joints, taps, snapshot } = tolerate(before);
  expect(joints).toEqual([]);
  expect(taps).toEqual([
    {
      id: "proximity:2:1|1",
      a: "2:1",
      segment: 1,
      kind: "tap-by-proximity",
      gapIn: expect.closeTo(0.3, 6),
      at: expect.closeTo(10, 6),
      point: [10, 0, 0],
      grade: "stretched",
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
    {
      id: "proximity:1:1|4:2",
      a: "1:1",
      b: "4:2",
      kind: "joined-by-proximity",
      gapIn: expect.closeTo(0.4, 6),
      // The ends meet square, not facing: accepted, not a near miss.
      grade: "stretched",
    },
  ]);
  expect(findings.map((f) => [f.id, f.kind])).toEqual([
    ["proximity:1:1|4:2", "joined-by-proximity"],
    ["loop-by-inference:1:1|4:2", "loop-by-inference"],
  ]);
  expect(groupTree(snapshot, "g1").backEdges).toHaveLength(1);
});

// A 30x30 plenum along +x; its side faces sit 15 in off the centerline.
const plenum = () => rect(1, [0, 0, 0], [10, 0, 0], 30, 30, "g1");
/** A 10 in branch ending `gapIn` off the plenum's +y side at x, z ft, running away along +y. */
const onSide = (id: number, x: number, z: number, gapIn: number) => {
  const y = (15 + gapIn) * IN;
  const d = duct(id, [x, y, z], [x, y + 5, z], `g${id}`);
  return { ...d, diameterIn: 10, connectors: d.connectors.map((c) => ({ ...c, diameterIn: 10 })) };
};

it("a duct landing off-center on a plenum's side taps it where it lands", () => {
  const { taps, findings } = inferJoints(snap([plenum(), onSide(2, 3, 8 * IN, 0.5)]));
  expect(taps).toEqual([
    {
      id: "proximity:2:1|1",
      a: "2:1",
      segment: 1,
      kind: "tap-by-proximity",
      gapIn: expect.closeTo(0.5, 6),
      at: expect.closeTo(3, 6),
      point: [3, 0, 0],
      grade: "stretched",
    },
  ]);
  expect(findings[0]!.note).toContain("lands on the side of duct 1");
});

it("two ducts landing on one side face both tap it", () => {
  const { taps } = inferJoints(snap([plenum(), onSide(2, 3, 0, 0.5), onSide(3, 6, -0.5, 1.5)]));
  expect(taps.map((t) => [t.a, t.segment, Math.round(t.at * 100) / 100])).toEqual([
    ["2:1", 1, 3],
    ["3:1", 1, 6],
  ]);
});

it("a duct stopping 1.6 in short of an end cap's face taps the capped duct at its end", () => {
  // Chadds 14122436 → cap 14107111 on plenum 14106988: the plenum ends at y 0, the cap face sits
  // CAP_THICKNESS_IN outboard of it, and the duct stops 1.6 in short of that face.
  const main = rect(1, [0, 10, 0], [0, 0, 0], 30, 30, "g1");
  const end = -(CAP_THICKNESS_IN + 1.6) * IN;
  const branch = duct(2, [0, -5, 0], [0, end, 0], "g2");
  const before = snap([main, branch], [cap(9, main, 2)]);
  const { taps, snapshot } = tolerate(before);
  expect(taps).toEqual([
    {
      id: "proximity:2:2|1",
      a: "2:2",
      segment: 1,
      kind: "tap-by-proximity",
      gapIn: expect.closeTo(1.6, 6),
      at: expect.closeTo(10, 6),
      point: [0, 0, 0],
      grade: "stretched",
    },
  ]);
  expect(snapshot.groups.map((g) => g.id)).toEqual(["g1"]);
  const tree = groupTree(snapshot, "g1");
  expect(tree.parent.get(2)).toBe(-1);
  expect(tree.parent.get(-1)).toBe(1);
  // Without the cap the end is no face: the same duct stays open.
  expect(inferJoints(snap([rect(1, [0, 10, 0], [0, 0, 0], 30, 30), branch])).taps).toEqual([]);
});

it("a duct running alongside a plenum within tolerance does not tap it", () => {
  const along = duct(2, [2, 16 * IN, 0], [5, 16 * IN, 0], "g2");
  expect(inferJoints(snap([plenum(), along])).taps).toEqual([]);
});

it("an ignore verdict withholds one landing and keeps the other on the same face", () => {
  const before = snap([plenum(), onSide(2, 3, 0, 0.5), onSide(3, 6, 0, 0.5)]);
  const { taps } = tolerate(before, ignoring("proximity:2:1|1"));
  expect(taps.map((t) => t.a)).toEqual(["3:1"]);
});

/** A 16x8 grille whose one open connector faces down at `at`, its body 1 in above. */
const grille = (id: number, at: number[]): Node => ({
  id,
  kind: "terminal",
  category: "Air Terminals",
  family: "Price LBP15A Supply",
  type: "16 X 8",
  partType: null,
  levelId: 1,
  point: [at[0]!, at[1]!, at[2]! + IN],
  groupId: `g${id}`,
  systemName: "SA 19",
  classification: "Supply Air",
  connectors: [
    {
      ...conn(1, at),
      shape: "rectangular",
      size: "16x8",
      diameterIn: null,
      widthIn: 16,
      heightIn: 8,
    },
  ],
  facts: [],
  uniqueId: null,
});

it("a duct rising into a grille's mouth 2 in off its centre joins the grille (Chadds SA 19)", () => {
  // 8750451's open end sits in grille 8747668's connector plane, 2.0 in off its centre in x.
  const riser = rect(2, [0, 0, 12], [0, 0, 10], 16, 8, "g2");
  const before = snap([riser], [grille(9, [2 * IN, 0, 12])]);
  const { joints, findings, snapshot } = tolerate(before);
  expect(joints).toEqual([
    {
      id: "proximity:2:1|9:1",
      a: "9:1",
      b: "2:1",
      kind: "joined-by-proximity",
      gapIn: expect.closeTo(0, 6),
      // 2.0 in off the mouth's centre: accepted, not a near miss.
      grade: "stretched",
    },
  ]);
  // The grille is read first, so it is the one landing; the rule is symmetric.
  expect(findings[0]!.id).toBe("proximity:2:1|9:1");
  expect(findings[0]!.note).toContain("2.00 in from its centre");
  expect(snapshot.nodes[0]!.connectors[0]!.connectedTo).toEqual({ elementId: 2, connector: 1 });
  // Beside the mouth, not under it: no join.
  expect(inferJoints(snap([riser], [grille(9, [12 * IN, 0, 12])])).joints).toEqual([]);
});

it("two ducts landing on one connector's face both join it, each to its own copy of the port", () => {
  const a = duct(2, [-3 * IN, 0, 12], [-3 * IN, 0, 10], "g2");
  const b = duct(3, [3 * IN, 0, 12], [3 * IN, 0, 10], "g3");
  const { joints, snapshot } = tolerate(snap([a, b], [grille(9, [0, 0, 12])]));
  expect(joints.map((j) => [j.a, j.b])).toEqual([
    ["9:1", "2:1"],
    ["3:1", "9:1"],
  ]);
  const ports = snapshot.nodes[0]!.connectors.map((c) => [c.index, c.connectedTo]);
  expect(ports).toEqual([
    [1, { elementId: 2, connector: 1 }],
    [2, { elementId: 3, connector: 1 }],
  ]);
  expect(snapshot.segments[1]!.connectors[0]!.connectedTo).toEqual({ elementId: 9, connector: 2 });
});

it("open ends of different classifications 0.4 in apart warn and stay open; a connect verdict joins them", () => {
  const before = snap([
    duct(1, [0, 0, 0], [10, 0, 0], "g1"),
    returnAir(duct(2, [10 + 0.4 * IN, 0, 0], [20, 0, 0], "g2")),
  ]);
  const id = "proximity:1:2|2:1";
  const out = tolerate(before);
  expect(out.joints).toEqual([]);
  expect(out.snapshot).toBe(before);
  expect(out.findings).toEqual([
    {
      id,
      kind: "near-miss-across-classifications",
      elementIds: [1, 2],
      note: "open ends 1:2 and 2:1 are 0.40 in apart, but 1:2 is SupplyAir and 2:1 is ReturnAir; not joined",
      grade: null,
    },
  ]);
  const joined = tolerate(before, staging(id, "connect"));
  expect(joined.joints.map((j) => j.id)).toEqual([id]);
  // Joined against the evidence by a person: anomalous, its note naming the repair.
  expect(joined.findings[0]).toMatchObject({ id, kind: "joined-by-proximity", grade: "anomalous" });
  expect(joined.findings[0]!.note).toBe(
    "6ø duct 1 (SA 1) and 6ø duct 2 (RA 1) are joined across air classifications by a person's connect verdict. Fix: put both on one system in Revit.",
  );
  // An ignore verdict on the warning silences it.
  expect(inferJoints(before, 1, ignoring(id)).findings).toEqual([]);
});

it("a supply branch landing on a return duct's side warns instead of tapping it", () => {
  // Chadds 6894422:1 on 7243161: a supply end on a return main is a near miss, not a tap.
  const out = inferJoints(snap([returnAir(plenum()), onSide(2, 3, 0, 0.5)]));
  expect(out.taps).toEqual([]);
  expect(out.findings.map((f) => [f.id, f.kind])).toEqual([
    ["proximity:2:1|1", "near-miss-across-classifications"],
  ]);
  expect(out.findings[0]!.note).toContain("2:1 is SupplyAir and 1 is ReturnAir; not joined");
  const anyway = inferJoints(
    snap([returnAir(plenum()), onSide(2, 3, 0, 0.5)]),
    1,
    staging("proximity:2:1|1", "connect"),
  );
  expect(anyway.taps.map((t) => t.id)).toEqual(["proximity:2:1|1"]);
});

it("an end deep inside a duct's body, pointing across it, taps it at its nearest point", () => {
  // Chadds 7266368:1 sits 3.3 in inside 14342882 (a real join, kaitpw checked in Revit); this
  // one sits on the plenum's centerline, 15 in past its face.
  const deep = duct(2, [4, 0, 0], [4, 5, 0], "g2");
  const { taps, findings } = tolerate(snap([plenum(), deep]));
  expect(taps).toMatchObject([
    {
      id: "proximity:2:1|1",
      a: "2:1",
      segment: 1,
      gapIn: expect.closeTo(-15, 6),
      point: [4, 0, 0],
    },
  ]);
  expect(findings[0]!.note).toContain("15.00 in into its face");
  // An overlap coming in through the plenum's (capped) start end and pointing deeper taps too ...
  const capped = plenum();
  const ends = [cap(9, capped, 1)];
  const overlap = duct(3, [-2, 0, 0], [1, 0, 0], "g3");
  expect(inferJoints(snap([capped, overlap], ends)).taps.map((t) => t.a)).toEqual(["3:2"]);
  // ... one pointing back out through the nearer end does not.
  const out = duct(3, [3, 0, 0], [1, 0, 0], "g3");
  expect(inferJoints(snap([capped, out], ends)).taps.map((t) => t.a)).not.toContain("3:2");
});

it("every inference is a finding a person clears; a near miss assumes nothing", () => {
  const before = snap([
    plenum(),
    onSide(2, 3, 0, 0.5),
    returnAir(duct(3, [20, 0, 0], [30, 0, 0], "g3")),
    duct(4, [30 + 0.4 * IN, 0, 0], [40, 0, 0], "g4"),
  ]);
  const findings = survey(before, null).findings.filter((f) => f.id.startsWith("proximity:"));
  expect(findings.map((f) => [f.kind, f.clearer, f.assumed != null])).toEqual([
    ["near-miss-across-classifications", "person", false],
    ["tap-by-proximity", "person", true],
  ]);
});

/** An 81x3.5 linear grille (Chadds 10922066): its one connector sits at its insertion point. */
const linear = (id: number, at: number[], facing?: number[]): Node => {
  const g = grille(id, at);
  const port = { ...g.connectors[0]!, size: "81x3.5", widthIn: 81, heightIn: 3.5 };
  return { ...g, point: at, connectors: [facing ? { ...port, facing } : port] };
};

it("a grille whose connector is its insertion point lands by its captured facing, and only by it", () => {
  // Duct 1 (6 in round) runs along x; the grille's mouth sits 0.5 in under it, facing up.
  const at = [10, 0, -3.5 * IN];
  const main = duct(1, [0, 0, 0], [20, 0, 0], "g1");
  const { taps, findings } = inferJoints(snap([main], [linear(9, at, [0, 0, 1])]));
  expect(taps).toEqual([
    {
      id: "proximity:9:1|1",
      a: "9:1",
      segment: 1,
      kind: "tap-by-proximity",
      gapIn: expect.closeTo(0.5, 6),
      at: expect.closeTo(10, 6),
      point: [10, 0, 0],
      grade: "stretched",
    },
  ]);
  expect(findings.map((f) => f.kind)).toEqual(["tap-by-proximity"]);
  // An older snapshot carries no facing: the axis cannot be derived from the point, nothing lands.
  expect(inferJoints(snap([main], [linear(9, at)]))).toEqual({
    joints: [],
    taps: [],
    inline: [],
    findings: [],
  });
});

it("a captured width axis rolls a rectangular duct's faces; without one a vertical rect is a band", () => {
  // A vertical 24x4 riser; a branch ends 0.5 in off a face, 10 in off centre along the width.
  const riser = (widthAxis?: number[]) => {
    const r = rect(1, [0, 0, 0], [0, 0, 10], 24, 4);
    return { ...r, connectors: r.connectors.map((c) => (widthAxis ? { ...c, widthAxis } : c)) };
  };
  const branch = duct(2, [10 * IN, 2.5 * IN, 5], [10 * IN, 5, 5], "g2");
  const tapsOf = (s: Segment) => inferJoints(snap([s, branch])).taps;
  // Width along x: the branch faces the 24 in side and lands 0.5 in short of it.
  expect(tapsOf(riser([1, 0, 0]))).toMatchObject([
    { a: "2:1", segment: 1, gapIn: expect.closeTo(0.5, 6), at: expect.closeTo(5, 6) },
  ]);
  // Width along y: the side it faces is the 4 in one, 8 in away; no landing.
  expect(tapsOf(riser([0, 1, 0]))).toEqual([]);
  // ponytail fallback: no roll, a vertical rect is the round-equivalent band, and this end misses it.
  expect(tapsOf(riser())).toEqual([]);
});

/** A two-port 6 in round damper centred at `at` along x, its ports 0.06 in apart and both open (Chadds 13568060). */
const damper = (id: number, at: number[], facing = false): Node => {
  const half = 0.03 * IN;
  const port = (index: number, dx: number) => ({
    ...conn(index, [at[0]! + dx, at[1]!, at[2]!]),
    ...(facing ? { facing: [Math.sign(dx), 0, 0] } : {}),
  });
  return {
    id,
    kind: "accessory",
    category: "Duct Accessories",
    family: "Damper_Volume_Round",
    type: "Round Volume Damper",
    partType: null,
    levelId: 1,
    point: at,
    groupId: `g${id}`,
    systemName: "SA 1",
    classification: "Supply Air",
    connectors: [port(1, half), port(2, -half)],
    facts: [],
    uniqueId: null,
  };
};

it("a damper inside a duct's body, aligned with it, neither end connected, is inline on it", () => {
  const host = duct(1, [0, 0, 0], [10, 0, 0], "g1");
  const next = duct(3, [10, 0, 0], [20, 0, 0], "g1");
  link(host, 2, next, 1);
  for (const facing of [false, true]) {
    const before = snap([host, next], [damper(9, [4, 0, 0], facing)]);
    const { inline, taps, joints, findings, links, snapshot } = tolerate(before);
    const id = "proximity:9|1";
    expect([taps, joints]).toEqual([[], []]);
    expect(inline).toEqual([
      {
        id,
        node: 9,
        segment: 1,
        kind: "inline-by-inference",
        ports: ["9:2", "9:1"],
        grade: "stretched",
      },
    ]);
    expect(findings).toEqual([
      {
        id,
        kind: "inline-by-inference",
        elementIds: [9, 1],
        note: "accessory 9 (Damper_Volume_Round) lies inside duct 1, 4.00 ft along it and aligned with it, with neither end connected; counted inline on it",
        grade: "stretched",
      },
    ]);
    expect(links).toEqual([
      { id, between: [1, 9], grade: "stretched", ruled: false },
      { id, between: [9, -1], grade: "stretched", ruled: false },
    ]);
    // The host is cut where the damper sits; its far half is virtual segment -1, carrying the
    // host's far end (still joined to duct 3) and the rest of its length.
    const [cut, far] = [
      snapshot.segments.find((s) => s.id === 1)!,
      snapshot.segments.find((s) => s.id === -1)!,
    ];
    expect(cut.lengthFt + far.lengthFt).toBeCloseTo(10 - 0.06 * IN, 9);
    expect(cut.polyline.at(-1)![0]).toBeCloseTo(4 - 0.03 * IN, 9);
    expect(far.connectors.map((c) => [c.index, c.connectedTo])).toEqual([
      [2, { elementId: 3, connector: 1 }],
      [3, { elementId: 9, connector: 1 }],
    ]);
    expect(snapshot.segments.find((s) => s.id === 3)!.connectors[0]!.connectedTo).toEqual({
      elementId: -1,
      connector: 2,
    });
    expect(snapshot.nodes[0]!.connectors.map((c) => c.connectedTo)).toEqual([
      { elementId: -1, connector: 3 },
      { elementId: 1, connector: 3 },
    ]);
    expect(snapshot.groups.map((g) => [g.id, g.elementCount])).toEqual([["g1", 4]]);
    expect(snapshot.issues.map((i) => i.id)).toEqual(["open-end:g1:1:1", "open-end:g1:3:2"]);
    const tree = groupTree(snapshot, "g1");
    expect([...tree.parts.keys()].sort((a, b) => a - b)).toEqual([-1, 1, 3, 9]);
    expect(before.segments[0]!.connectors).toHaveLength(2);
  }
});

it("an inline part is a person-ruled warning an ignore verdict withholds; a connected or misaligned one is not inline", () => {
  const host = () => duct(1, [0, 0, 0], [10, 0, 0], "g1");
  const findings = survey(snap([host()], [damper(9, [4, 0, 0])]), null).findings;
  expect(findings.find((f) => f.id === "proximity:9|1")).toMatchObject({
    kind: "inline-by-inference",
    clearer: "person",
    assumed: expect.stringContaining("neither end connected"),
  });
  expect(
    inferJoints(snap([host()], [damper(9, [4, 0, 0])]), 1, ignoring("proximity:9|1")).inline,
  ).toEqual([]);
  // One end connected: the rule needs both open.
  const joined = damper(9, [4, 0, 0]);
  const other = duct(2, [4, 5, 0], [4, 10, 0], "g9");
  joined.connectors[0]!.connectedTo = { elementId: 2, connector: 1 };
  other.connectors[0]!.connectedTo = { elementId: 9, connector: 1 };
  expect(inferJoints(snap([host(), other], [joined])).inline).toEqual([]);
  // Across the run, not along it.
  const across = damper(9, [4, 0, 0], true);
  across.connectors = across.connectors.map((c, i) => ({ ...c, facing: [0, i ? -1 : 1, 0] }));
  expect(inferJoints(snap([host()], [across])).inline).toEqual([]);
  // Outside the body: no host.
  expect(inferJoints(snap([host()], [damper(9, [4, 1, 0])])).inline).toEqual([]);
});

// ---- grades (pressure-drop ledger, 2026-10-19: inference may compute, never conclude) --------

/** Duct 1 along +x ending at x 10; duct 2 starting `gapIn` past it, `lateralIn` off its axis, turned `deg`. */
const pair = (gapIn: number, lateralIn = 0, deg = 0) => {
  const start = [10 + gapIn * IN, lateralIn * IN, 0];
  const r = (deg * Math.PI) / 180;
  return [
    duct(1, [0, 0, 0], [10, 0, 0], "g1"),
    duct(2, start, [start[0]! + 10 * Math.cos(r), start[1]! + 10 * Math.sin(r), 0], "g2"),
  ];
};
const gradeOf = (segments: Segment[], nodes: Node[] = []) =>
  inferJoints(snap(segments, nodes)).findings.map((f) => [f.kind, f.grade]);

it("an open-to-open join is a near miss only sub-inch, of one classification, opposed and centred", () => {
  expect(gradeOf(pair(0.9))).toEqual([["joined-by-proximity", "near-miss"]]);
  // Centred within NEAR_MISS_CENTRED_IN (0.5 in) of the axis, and not.
  expect(gradeOf(pair(0.3, 0.4))).toEqual([["joined-by-proximity", "near-miss"]]);
  expect(gradeOf(pair(0.3, 0.6))).toEqual([["joined-by-proximity", "stretched"]]);
  // Opposed: cos below -0.9 at 20 degrees, not at 30.
  expect(gradeOf(pair(0.3, 0, 20))).toEqual([["joined-by-proximity", "near-miss"]]);
  expect(gradeOf(pair(0.3, 0, 30))).toEqual([["joined-by-proximity", "stretched"]]);
  // One side states no classification: not the same one.
  const [a, b] = pair(0.3);
  b!.connectors = b!.connectors.map((c) => ({ ...c, classification: null }));
  expect(gradeOf([a!, b!])).toEqual([["joined-by-proximity", "stretched"]]);
  // Past 1 in, a mouth landing within FACE_TOL_IN joins but is stretched.
  const riser = rect(2, [0, 0, 12 + 1.5 * IN], [0, 0, 14], 16, 8, "g2");
  riser.connectors[0]!.facing = [0, 0, -1];
  const up = grille(9, [0, 0, 12]);
  up.connectors[0]!.facing = [0, 0, 1];
  expect(gradeOf([riser], [up])).toEqual([["joined-by-proximity", "stretched"]]);
});

it("captured facings pointing one way join anomalous, the note naming the reversed connector", () => {
  const [a, b] = pair(0.3);
  a!.connectors[1]!.facing = [1, 0, 0];
  b!.connectors[0]!.facing = [1, 0, 0];
  const { findings } = inferJoints(snap([a!, b!]));
  expect(findings).toMatchObject([{ kind: "joined-by-proximity", grade: "anomalous" }]);
  expect(findings[0]!.note).toBe(
    "6ø duct 1 (SA 1) and 6ø duct 2 (SA 1) are joined though their connectors face the same way, so one is reversed. Fix: flip the reversed connector (Family Foundry migration) or replace the family.",
  );
});

/** A takeoff whose open port sits `deepIn` inside the plenum's +y side, facing into it. */
const takeoff = (id: number, deepIn: number): Node => ({
  id,
  kind: "fitting",
  category: "Duct Fittings",
  family: "Rectangular Takeoff",
  type: "Standard",
  partType: "TapAdjustable",
  levelId: 1,
  point: [3, (15 - deepIn) * IN, 0],
  groupId: `g${id}`,
  systemName: "SA 70",
  classification: "Supply Air",
  connectors: [
    { ...conn(1, [3, (15 - deepIn) * IN, 0]), facing: [0, -1, 0] },
    { ...conn(2, [3, (15 - deepIn + 6) * IN, 0]), facing: [0, 1, 0] },
  ],
  facts: [],
  uniqueId: null,
});

it("a part's port deeper than THROUGH_IN in a duct's body is placed through it: anomalous; a duct end there is stretched", () => {
  expect(gradeOf([plenum()], [takeoff(9, 0.5)])).toEqual([["tap-by-proximity", "stretched"]]);
  const { findings } = inferJoints(snap([plenum()], [takeoff(9, 1.5)]));
  expect(findings).toMatchObject([{ kind: "tap-by-proximity", grade: "anomalous" }]);
  expect(findings[0]!.note).toBe(
    "Rectangular Takeoff Standard fitting 9 (SA 70)'s connector sits 1.50 in inside 30x30 duct 1 (SA 1), 3.00 ft along it, not at its end; tapped there. Fix: move the part to the duct's end or face, or replace the family.",
  );
  // A duct end 15 in inside a body is a real join kind (Chadds 7266368 on 14342882): stretched.
  expect(gradeOf([plenum(), duct(2, [4, 0, 0], [4, 5, 0], "g2")])).toEqual([
    ["tap-by-proximity", "stretched"],
  ]);
  // An inline part is stretched.
  expect(gradeOf([duct(1, [0, 0, 0], [10, 0, 0])], [damper(9, [4, 0, 0])])).toEqual([
    ["inline-by-inference", "stretched"],
  ]);
});

/** Chadds 8911461: a vertical 72x3 plenum, its top capped, its open bottom facing down. */
const slotPlenum = () => {
  const s = rect(1, [0, 0, 0], [0, 0, 1.349], 72, 3, "g1");
  s.connectors = s.connectors.map((c) => ({
    ...c,
    facing: [0, 0, c.index === 1 ? -1 : 1],
    widthAxis: [1, 0, 0],
  }));
  return s;
};
const slot = (z: number, facing = [0, 0, -1]) => {
  const g = linear(9, [0.03, 0, z], facing);
  g.connectors[0]!.widthAxis = [1, 0, 0];
  return g;
};

it("a terminal facing the wrong way in a duct's open end joins it anyway, always anomalous (Chadds 10922066)", () => {
  const plenum = slotPlenum();
  const ends = [cap(8, plenum, 2)];
  const { joints, findings } = inferJoints(snap([plenum], [...ends, slot(4.75 * IN)]));
  expect(joints).toMatchObject([
    { id: "proximity:1:1|9:1", a: "9:1", b: "1:1", grade: "anomalous" },
  ]);
  expect(findings[0]!.note).toBe(
    "Price LBP15A Supply 16 X 8 terminal 9 (SA 19)'s connector 9:1 faces away from its duct and it sits inside 72x3 duct 1 (SA 1), 4.75 in from its open end, not at its end; treated as SA 1's terminal. Fix: replace the stand-in family or flip its connector (Family Foundry migration).",
  );
  // Within FACE_TOL_IN beyond the open end, facing away: joined, anomalous.
  const beyond = inferJoints(snap([slotPlenum()], [slot(-1 * IN)]));
  expect(beyond.findings).toMatchObject([{ id: "proximity:1:1|9:1", grade: "anomalous" }]);
  expect(beyond.findings[0]!.note).toContain("sits at the open end of 72x3 duct 1 (SA 1), 1.00 in beyond it");
  // Past FACE_TOL_IN outside the duct, or facing across it from beyond its end: nothing joins.
  expect(inferJoints(snap([slotPlenum()], [slot(-3 * IN)])).joints).toEqual([]);
  expect(inferJoints(snap([slotPlenum()], [slot(-1 * IN, [1, 0, 0])])).joints).toEqual([]);
  // A staged ignore breaks it.
  expect(
    inferJoints(snap([slotPlenum()], [slot(-1 * IN)]), 1, ignoring("proximity:1:1|9:1")).joints,
  ).toEqual([]);
});

it("a staged connect confirms an inference on its link; a proposal does not", () => {
  const before = snap(pair(0.3, 0.6));
  const id = "proximity:1:2|2:1";
  expect(tolerate(before).links).toEqual([
    { id, between: [1, 2], grade: "stretched", ruled: false },
  ]);
  expect(tolerate(before, staging(id, "connect")).links[0]!.ruled).toBe(true);
  const proposed = ductsDocumentSchema.parse({
    assumptions: { [id]: { proposal: { value: { kind: "verdict", verdict: "connect" } } } },
  });
  expect(tolerate(before, proposed).links[0]!.ruled).toBe(false);
});
