/** Deterministic connector and proximity cuts, with optional saved Project A coverage. */
import { designOf } from "@pe/ducts-domain/test-design";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";

import { groupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import {
  connOf,
  ductOf,
  nodeOf,
  slots,
  snapshotOf,
  type Node,
  type Segment,
} from "@pe/ducts-domain/test-snapshot";

import { legsOf } from "./legs";

type Row = { id: number; k: Node["kind"] | "duct"; p: number[]; line?: number[][] };

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
  const connector = (index: number, point: number[], to: Row | undefined, size: string) =>
    connOf(index, to ? [to.id, index === 1 ? 2 : 1] : null, { point, size, diameterIn: 8 });
  const nodes: Node[] = [];
  const segments: Segment[] = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    // The riser into the attic is a size up, so the dominant size per leg is observable.
    const size = i >= 46 && i <= 70 ? '10"Ã¸' : '8"Ã¸';
    const levelId = levelAt(row.p[2]!);
    if (row.k === "duct") {
      const [a, b] = row.line as [number[], number[]];
      segments.push(
        ductOf(row.id, {
          type: "Round Duct",
          size,
          diameterIn: 8,
          lengthFt: ft(a, b),
          polyline: [a, b],
          levelId,
          groupId: "g1",
          connectors: [connector(1, a, prev, size), connector(2, b, next, size)],
        }),
      );
      return;
    }
    nodes.push(
      nodeOf(row.id, row.k, {
        family: row.k,
        type: "Std",
        levelId,
        point: row.p,
        groupId: "g1",
        connectors: [connector(1, row.p, prev, size), connector(2, row.p, next, size)],
      }),
    );
  });
  return snapshotOf({
    document: {
      title: "makeup",
      readAt: "2026-10-17T00:00:00Z",
      elapsedMs: 0,
      networkBasedCalculations: false,
    },
    levels: LEVELS,
    nodes,
    segments,
    slots: { ...slots, fanStatic: "", fanFlow: "", componentDrop: "" },
  });
}

// The client model stays outside git; the dev knob `PE_DUCTS_FIXTURE` names it (vite.config.ts).
const FIXTURE = process.env.PE_DUCTS_FIXTURE ?? "";
it.skipIf(!FIXTURE || !existsSync(FIXTURE))(
  "project-a: a group's longest run cuts from its unit to its terminal with real connectors",
  () => {
    const snapshot: DuctSnapshot = JSON.parse(readFileSync(FIXTURE, "utf8"));
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
  // Project A: open duct 14122436 stops 2.63 in short of plenum 14106988's end, which end cap
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
  // A tap on a capped end is accepted but not a near miss: stretched, until a person confirms it.
  expect(cut.inferred).toEqual([
    { after: 14107111, before: 14122436, findingId: finding, grade: "stretched", confirmed: false },
  ]);
  const work = designOf({
    assumptions: { [finding]: { edit: { value: { kind: "verdict", verdict: "ignore" } } } },
  });
  const ruled = legsOf(snapshot, ids, undefined, work);
  expect(ruled.inferred).toEqual([]);
  expect(ruled.gaps).toEqual([{ after: 14107111, before: 14122436 }]);
  // A person's edit connect confirms it; the break stays drawn, ruled.
  const confirmed = designOf({
    assumptions: { [finding]: { edit: { value: { kind: "verdict", verdict: "connect" } } } },
  });
  expect(legsOf(snapshot, ids, undefined, confirmed).inferred).toMatchObject([
    { findingId: finding, confirmed: true },
  ]);
});
