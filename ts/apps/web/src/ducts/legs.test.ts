/**
 * /ducts scene legs, deterministic: the Chadds makeup-air trace (88 ordered elements Pea walked on
 * 2026-10-17, `fixtures/makeup-path.json`, shaped here into a minimal snapshot on Main 0 / Upper
 * 12.5 / Attic 24.083 ft) cuts into 9 legs and 7 nodes; and, when `PE_DUCTS_FIXTURE` names the
 * saved Project A snapshot, a group's longest run cuts with real connectors, and a skipped id is a gap.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";

import { ductsDocumentSchema } from "@pe/agent-contracts";
import { labelOfNode, legsOf, OMISSION_HOPS } from "./legs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { groupTree } from "@pe/ducts-domain/topology";
import trace from "./fixtures/makeup-path.json";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Row = { id: number; k: string; p: number[]; line?: number[][] };

const LEVELS = [
  { id: 30, name: "Main", elevationFt: 0 },
  { id: 9946, name: "Upper", elevationFt: 12.5 },
  { id: 5765339, name: "Attic", elevationFt: 24.083 },
];
/** The highest level at or under z, as a duct's reference level would be when drawn on it. */
const levelAt = (z: number) =>
  [...LEVELS].reverse().find((level) => level.elevationFt <= z + 1e-6)?.id ?? LEVELS[0]!.id;
const ft = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** The trace as a chain: connector 1 reaches the row before, connector 2 the row after. */
function makeupSnapshot(rows: Row[]): DuctSnapshot {
  const connector = (index: number, point: number[], to: Row | undefined, size: string) => ({
    index,
    kind: "end",
    point,
    shape: "round" as const,
    size,
    diameterIn: 8,
    direction: "bidirectional",
    connectedTo: to ? { elementId: to.id, connector: index === 1 ? 2 : 1 } : null,
  });
  const nodes: Node[] = [];
  const segments: Segment[] = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    // The riser into the attic is a size up, so the dominant size per leg is observable.
    const size = i >= 46 && i <= 70 ? '10"ø' : '8"ø';
    if (row.k === "duct") {
      const [a, b] = row.line as [number[], number[]];
      segments.push({
        id: row.id,
        kind: "duct",
        type: "Round Duct",
        shape: "round",
        size,
        diameterIn: 8,
        lengthFt: ft(a, b),
        polyline: [a, b],
        levelId: levelAt(row.p[2]!),
        groupId: "g1",
        roughness: { valueFt: 0.0003, provenance: "revit-default" },
        revit: {},
        connectors: [connector(1, a, prev, size), connector(2, b, next, size)],
      } as Segment);
      return;
    }
    const family =
      { fitting: "Round Elbow", accessory: "Damper", equipment: "Unit" }[row.k] ?? row.k;
    nodes.push({
      id: row.id,
      kind: row.k,
      category: row.k,
      family,
      type:
        row.k === "equipment"
          ? `E${nodes.filter((n) => n.kind === "equipment").length + 1}`
          : "Std",
      levelId: levelAt(row.p[2]!),
      point: row.p,
      groupId: "g1",
      connectors: [connector(1, row.p, prev, size), connector(2, row.p, next, size)],
      facts: [],
    } as Node);
  });
  return {
    document: {
      title: "makeup",
      readAt: "2026-10-17T00:00:00Z",
      elapsedMs: 0,
      networkBasedCalculations: false,
    },
    levels: LEVELS,
    groups: [],
    nodes,
    segments,
    flows: [],
    issues: [],
    layers: [],
    systems: [],
    slots: { fanStatic: "", fanFlow: "", componentDrop: "" },
  } as unknown as DuctSnapshot;
}

const rows = trace as Row[];
const ids = rows.map((row) => row.id);

it("a node's label (the snapshot's DuctNode.label) names its place; an unlabelled node falls back to type", () => {
  const snapshot = makeupSnapshot(rows);
  snapshot.nodes.find((node) => node.id === 14577391)!.label = "AHU-7";
  const cut = legsOf(snapshot, ids, labelOfNode(snapshot));
  expect(cut.nodes.map((place) => place.name)).toContain("AHU-7");
  expect(cut.legs.map((leg) => leg.name)).toContain("Damper Std → AHU-7");
  expect(cut.legs.map((leg) => leg.name)).toContain("AHU-7 → Unit E2");
  // With no label anywhere, nothing changes: the same cut as the unlabelled one.
  const plain = makeupSnapshot(rows);
  expect(legsOf(plain, ids, labelOfNode(plain))).toEqual(legsOf(plain, ids));
});

it("makeup route: 88 elements cut into 9 legs and 7 nodes at equipment, the damper and three level crossings", () => {
  const snapshot = makeupSnapshot(rows);
  const cut = legsOf(snapshot, ids, (id) => (id === 14577391 ? "MAU-1" : null));

  expect(cut.gaps).toEqual([]);
  expect(cut.legs).toHaveLength(9);
  // The subject starts on a duct (open), passes the damper and three units, climbs into the attic,
  // drops back through Upper to Main, and ends between the last two units.
  expect(cut.nodes.map((n) => n.kind)).toEqual([
    "open",
    "accessory",
    "equipment",
    "equipment",
    "equipment",
    "equipment",
    "equipment",
  ]);
  expect(cut.legs.map((leg) => leg.name)).toEqual([
    "open → Damper Std",
    "Damper Std → MAU-1",
    "MAU-1 → Unit E2",
    "Unit E2 → Unit E3",
    "Unit E3 → Attic",
    "Attic → Upper",
    "Upper → Main",
    "Main → Unit E4",
    "Unit E4 → Unit E5",
  ]);
  const level = (name: string) => LEVELS.find((l) => l.name === name)!.id;
  expect(cut.legs.map((leg) => leg.levelId)).toEqual([
    level("Upper"),
    level("Upper"),
    level("Upper"),
    level("Upper"),
    level("Upper"),
    level("Attic"),
    level("Upper"),
    level("Main"),
    level("Main"),
  ]);
  // A level place is the first duct on the new level, so the drawing can pin it.
  expect(cut.legs[4]!.to).toEqual({ id: 14285478, kind: "level", name: "Attic" });
  expect(cut.legs[5]!.size).toBe('10"ø');
  expect(cut.legs[0]!.size).toBe('8"ø');
  // Every subject element is in exactly one leg or is a node; the places are not leg members.
  const covered = [
    ...cut.legs.flatMap((leg) => leg.ids),
    ...cut.nodes.filter((n) => n.kind !== "open").map((n) => n.id),
  ];
  expect(covered.sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  expect(cut.legs.reduce((sum, leg) => sum + leg.fittings, 0)).toBe(38);
  expect(cut.legs.reduce((sum, leg) => sum + leg.lengthFt, 0)).toBeCloseTo(
    snapshot.segments.reduce((sum, s) => sum + s.lengthFt, 0),
  );
});

it("a subject that skips a connected element reports an omission, not a gap, and keeps cutting", () => {
  const snapshot = makeupSnapshot(rows);
  const skipped = ids.filter((id) => id !== 14606587); // the duct between elbows 3 and 5
  const cut = legsOf(snapshot, skipped);
  expect(cut.gaps).toEqual([]);
  expect(cut.omissions).toEqual([{ after: 14606595, before: 14606630, skipped: [14606587] }]);
  expect(cut.legs).toHaveLength(9);
  expect(() => legsOf(snapshot, [1])).toThrow("subject id 1 is not in the snapshot");
});

it("a break the snapshot bridges outside the subject is an omission; one it cannot bridge is a gap", () => {
  // The wave-3 Chadds cases, as a chain: open duct 14122436 is NOT joined to end cap 14107111, while
  // FR-1 13760866 reaches FC-23 13760867 only through 13761466, 13761629 and 13761574.
  const chain = [
    14088043, 14107098, 14106988, 14107111, 14122436, 14199815, 13760866, 13761466, 13761629,
    13761574, 13760867,
  ];
  const snapshot = makeupSnapshot(
    chain.map((id, i) => ({ id, k: i % 2 ? "fitting" : "accessory", p: [i, 0, 0] })),
  );
  // makeupSnapshot chains every row to its neighbour; cut the one real break.
  for (const node of snapshot.nodes)
    for (const c of node.connectors)
      if (
        (node.id === 14107111 && c.connectedTo?.elementId === 14122436) ||
        (node.id === 14122436 && c.connectedTo?.elementId === 14107111)
      )
        c.connectedTo = null;
  const subject = [14088043, 14107098, 14106988, 14107111, 14122436, 14199815, 13760866, 13760867];
  const cut = legsOf(snapshot, subject);
  expect(cut.gaps).toEqual([{ after: 14107111, before: 14122436 }]);
  expect(cut.omissions).toEqual([
    { after: 13760866, before: 13760867, skipped: [13761466, 13761629, 13761574] },
  ]);
  // A chain longer than the search cap is a gap: nothing is claimed past OMISSION_HOPS connections.
  const long = Array.from({ length: OMISSION_HOPS + 2 }, (_, i) => 900 + i);
  const far = makeupSnapshot(long.map((id, i) => ({ id, k: "fitting", p: [i, 0, 0] })));
  expect(legsOf(far, [900, long.at(-1)!]).gaps).toHaveLength(1);
  expect(legsOf(far, [900, long.at(-2)!]).omissions[0]?.skipped).toHaveLength(OMISSION_HOPS - 1);
});

// The client model stays outside git; the dev knob `PE_DUCTS_FIXTURE` names it (vite.config.ts).
const FIXTURE = process.env.PE_DUCTS_FIXTURE ?? "";
it.skipIf(!FIXTURE || !existsSync(FIXTURE))(
  "project-a: a group's longest run cuts from its unit to its terminal with real connectors",
  () => {
    const snapshot = JSON.parse(readFileSync(FIXTURE, "utf8")) as DuctSnapshot;
    const tree = groupTree(snapshot, "g6119626");
    const subject = [tree.root!.equipment!, ...tree.longest];
    const cut = legsOf(snapshot, subject);
    expect(cut.gaps).toEqual([]);
    expect(cut.legs[0]!.from.kind).toBe("equipment");
    expect(cut.legs.at(-1)!.to.kind).toBe("terminal");
    expect(cut.nodes.every((n) => n.kind !== "open")).toBe(true);
    const covered = [...cut.legs.flatMap((leg) => leg.ids), ...cut.nodes.map((n) => n.id)];
    expect(covered.sort((a, b) => a - b)).toEqual([...subject].sort((a, b) => a - b));
    const broken = subject.filter((_, i) => i !== 3);
    expect(legsOf(snapshot, broken).omissions).toEqual([
      { after: subject[2], before: subject[4], skipped: [subject[3]] },
    ]);
  },
);

it("a break the builder bridges by proximity is inferred, not a gap, until a verdict ignores it", () => {
  // Chadds: open duct 14122436 stops 2.63 in short of plenum 14106988's end, which end cap
  // 14107111 closes (its face 1 in outboard); the builder taps the plenum there.
  const rows: Row[] = [
    { id: 14088043, k: "terminal", p: [0, 10, 0] },
    {
      id: 14106988,
      k: "duct",
      p: [0, 10, 0],
      line: [
        [0, 10, 0],
        [0, 0, 0],
      ],
    },
    { id: 14107111, k: "cap", p: [0, 0, 0] },
    {
      id: 14122436,
      k: "duct",
      p: [0, -0.219, 0],
      line: [
        [0, -0.219, 0],
        [0, -5, 0],
      ],
    },
    { id: 14199815, k: "terminal", p: [0, -5, 0] },
  ];
  const snapshot = makeupSnapshot(rows);
  snapshot.groups = [
    {
      id: "g1",
      rootIds: [],
      classifications: [],
      systemNames: [],
      terminalCount: 2,
      elementCount: rows.length,
      loops: 0,
      issueIds: [],
    },
  ];
  for (const element of [...snapshot.nodes, ...snapshot.segments])
    for (const c of element.connectors)
      if (
        [14107111, 14122436].includes(element.id) &&
        [14107111, 14122436].includes(c.connectedTo?.elementId ?? 0)
      )
        c.connectedTo = null;
  const ids = rows.map((row) => row.id);
  const finding = "proximity:14122436:1|14106988";
  const cut = legsOf(snapshot, ids);
  expect(cut.gaps).toEqual([]);
  expect(cut.inferred).toEqual([{ after: 14107111, before: 14122436, findingId: finding }]);
  const work = ductsDocumentSchema.parse({
    assumptions: { [finding]: { staged: { value: { kind: "verdict", verdict: "ignore" } } } },
  });
  const ruled = legsOf(snapshot, ids, undefined, work);
  expect(ruled.inferred).toEqual([]);
  expect(ruled.gaps).toEqual([{ after: 14107111, before: 14122436 }]);
});
