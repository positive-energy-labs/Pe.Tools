/**
 * Proximity inference, deterministic: a small gap joins, a wide one does not, a branch end landing
 * on a duct's face (a side, off-center or shared, or an end a cap closes) taps it, one alongside
 * does not, a edit ignore verdict withholds the inference, and an inference that closes a ring
 * is also a loop finding. Ends of different air classifications never join without a edit
 * connect verdict, an end anywhere inside a duct's body taps it, and every inference is a finding
 * a person clears (kaitpw 2026-10-19). Points are model feet; the tolerance is inches.
 */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema, type DuctsRouteDocument } from "@pe/agent-contracts";

import { inferJoints, tolerate, MISSED_JOIN_MAX_IN } from "./proximity.ts";
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
    slots: {
      fanStatic: "",
      fanFlow: "",
      componentDrop: "",
      fittingCoefficient: "",
      terminalFlow: "",
    },
  };
};
const staging = (id: string, verdict: "ignore" | "connect"): DuctsRouteDocument =>
  ductsDocumentSchema.parse({
    assumptions: { [id]: { edit: { value: { kind: "verdict", verdict } } } },
  });
const ignoring = (id: string) => staging(id, "ignore");

it("reports a facing 2.88 in gap without joining it, while a 1.5 in gap still infers", () => {
  const at = (gapIn: number) =>
    snap([duct(1, [0, 0, 0], [10, 0, 0]), duct(2, [10 + gapIn * IN, 0, 0], [20, 0, 0])]);
  const raw = at(2.88);
  const wide = inferJoints(raw);
  expect(wide.joints).toEqual([]);
  expect(tolerate(raw).snapshot).toBe(raw);
  expect(tolerate(raw).links).toEqual([]);
  expect(wide.findings.filter((f) => f.kind === "missed-join")).toMatchObject([
    {
      id: "missed-join:1:2|2:1",
      connectors: ["1:2", "2:1"],
      gapIn: expect.closeTo(2.88, 5),
      grade: null,
    },
  ]);
  const small = inferJoints(at(1.5));
  expect(small.joints).toHaveLength(1);
  expect(small.findings.some((f) => f.kind === "missed-join")).toBe(false);
  expect(inferJoints(at(MISSED_JOIN_MAX_IN)).findings.some((f) => f.kind === "missed-join")).toBe(
    true,
  );
  expect(inferJoints(at(MISSED_JOIN_MAX_IN + 0.1)).findings).toEqual([]);
});

it("does not report larger open gaps when faces share a direction or miss the section", () => {
  for (const [facings, offset] of [
    [
      [
        [1, 0, 0],
        [1, 0, 0],
      ],
      0,
    ],
    [
      [
        [1, 0, 0],
        [-1, 0, 0],
      ],
      7 * IN,
    ],
  ] as const) {
    const a = duct(1, [0, 0, 0], [10, 0, 0]);
    const b = duct(2, [10 + 2.88 * IN, offset, 0], [20, offset, 0]);
    a.connectors[1]!.facing = [...facings[0]];
    b.connectors[0]!.facing = [...facings[1]];
    expect(inferJoints(snap([a, b])).findings.some((f) => f.kind === "missed-join")).toBe(false);
  }
});

it("reports opposed overlapping mouths too, as captured in Chadds SA 44", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const b = duct(2, [10 + 2.88 * IN, 0, 0], [20, 0, 0]);
  a.connectors[1]!.facing = [-1, 0, 0];
  b.connectors[0]!.facing = [1, 0, 0];
  const inferred = inferJoints(snap([a, b]));
  expect(inferred.joints).toEqual([]);
  expect(inferred.findings.filter((f) => f.kind === "missed-join")).toHaveLength(1);
});
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

it("a edit ignore verdict on the finding id withholds that inference", () => {
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

/** A two-port 6 in round damper centred at `at` along x, its ports 0.06 in apart and both open (Project A 13568060). */
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
        note: "accessory (Damper_Volume_Round) lies inside duct 1, 4.00 ft along it and aligned with it, with neither end connected; counted inline on it",
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

it("a edit connect confirms an inference on its link; a suggestion does not", () => {
  const before = snap(pair(0.3, 0.6));
  const id = "proximity:1:2|2:1";
  expect(tolerate(before).links).toEqual([
    { id, between: [1, 2], grade: "stretched", ruled: false },
  ]);
  expect(tolerate(before, staging(id, "connect")).links[0]!.ruled).toBe(true);
  const proposed = ductsDocumentSchema.parse({
    assumptions: { [id]: { suggestion: { value: { kind: "verdict", verdict: "connect" } } } },
  });
  expect(tolerate(before, proposed).links[0]!.ruled).toBe(false);
});
