/**
 * /ducts loss solver, deterministic. Interpolation is checked on three real ASHRAE grids shipped
 * with Revit (copied to fixtures/ashrae, parsed here by a test-only reader) against the values
 * `.artifacts/pdrop/sa26/ctable.md` lists; friction against handcalc.json; the pipeline on a small
 * synthetic network whose totals were computed independently in Python from the same grids.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { ductsRouteState, stagedDucts } from "@pe/agent-contracts";

import { lookupGrid, toGrids, type Grid, type Grids } from "@pe/ducts-domain/loss-grid";
import { friction, roundSection, sectionOf } from "@pe/ducts-domain/loss-physics";
import { computeLosses, fanout, systemFor } from "@pe/ducts-domain/losses";
import { price, stagedFanout } from "@pe/ducts-domain/pricing";
import { indexOf, lossesOf, sceneOf } from "./scene";
import { groupTree } from "@pe/ducts-domain/topology";
import synthetic from "./fixtures/synthetic-snapshot.json";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import rootAttached from "./fixtures/root-attached-fittings.json";
import physicalTransitions from "./fixtures/physical-transitions.json";

// ---- test-only .tbl reader (ctable.py parse) ------------------------------------------------
function parseTbl(name: string): Record<string, Grid> {
  const text = readFileSync(join(__dirname, "fixtures", "ashrae", `${name}.tbl`), "latin1");
  const out: Record<string, Grid> = {};
  for (const block of text.split(/\r?\n=+\r?\n/)) {
    if (!block.trim() || block.trim().startsWith("'")) continue;
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !/^[#\s]+$/.test(l));
    const title = lines[0]!.trim();
    const rest = lines.slice(1);
    const head = rest.findIndex((l) => l.includes("->"));
    if (head >= 0) {
      const res = rest.find((l) => /^\s*C\w*\s*$/.test(l))?.trim() ?? "Co";
      const [xLabel, xs] = rest[head]!.split("->");
      const y: number[] = [];
      const grid: number[][] = [];
      for (const l of rest.slice(head + 1).filter((l) => /^\s*[-\d.]/.test(l))) {
        const v = l.trim().split(/\s+/).map(Number);
        y.push(v[0]!);
        grid.push(v.slice(1));
      }
      out[res] = {
        title,
        xLabel: xLabel!.trim(),
        x: xs!.trim().split(/\s+/).map(Number),
        yLabel: rest[head + 1]!.trim(),
        y,
        grid,
      };
    } else {
      const header = rest.find((l) => /\d+\(\d+\)/.test(l))!;
      const x = [...header.matchAll(/(\d+(?:\.\d+)?)\(\d+\)/g)].map((m) => Number(m[1]));
      const co = rest.find((l) => l.trim().startsWith("Co"))!;
      out.Co = { title, xLabel: "D", x, grid: co.trim().split(/\s+/).slice(1).map(Number) };
    }
  }
  return out;
}
const grids: Grids = {
  "CD3-2": parseTbl("Cd3-2"),
  "CD3-21": parseTbl("Cd3-21"),
  "SD5-9": parseTbl("Sd5-9"),
  "SR4-3": parseTbl("Sr4-3"),
  "SD4-2": parseTbl("Sd4-2"),
};

it("interpolates the real tables to the values ctable.md lists", () => {
  // 1-D, exact node and clamped.
  expect(lookupGrid(grids["CD3-2"]!.Co!, 8).value).toBeCloseTo(0.24, 6);
  expect(lookupGrid(grids["CD3-2"]!.Co!, 4.5).value).toBeCloseTo(0.335, 6); // 0.37 -> 0.30
  const clamped = lookupGrid(grids["CD3-2"]!.Co!, 12);
  expect(clamped.value).toBe(0.24);
  expect(clamped.notes).toEqual(["D clamped at 10"]);
  // 2-D bilinear.
  expect(lookupGrid(grids["SD5-9"]!.Cb!, 0.4292, 0.36).value).toBeCloseTo(0.9704, 4);
  expect(lookupGrid(grids["SD5-9"]!.Cs!, 0.5708, 1).value).toBeCloseTo(0.1788, 4);
  expect(lookupGrid(grids["SR4-3"]!.Co!, 45, 1.698).value).toBeCloseTo(0.921, 3);
  // A grid refuses inputs it does not take.
  expect(() => lookupGrid(grids["CD3-2"]!.Co!, 8, 1)).toThrow();
  expect(() => lookupGrid(grids["SR4-3"]!.Co!, 45)).toThrow();
});

it("matches the hand-calc friction row", () => {
  // handcalc.json: duct 12 in, 4.119 ft at 450 cfm, f 0.02149 -> 0.0018106 in-wg.
  const f = friction(roundSection(12), 450, 4.119, 0.0003);
  expect(f.dp).toBeCloseTo(0.0018106, 7);
  expect(f.f).toBeCloseTo(0.02149, 5);
  expect(f.fpm).toBeCloseTo(573, 0);
});

// ---- synthetic network: unit 100 -> duct 1 -> elbow 2 -> duct 3 (tap 4 at 5 ft) -> transition 5
// -> grille 6 (200 cfm, 0.05); tap 4 -> duct 7 -> terminal 8 (100 cfm, 0.08). ------------------
type Conn = DuctSnapshot["nodes"][number]["connectors"][number];
const round = (d: number) => ({ shape: "round" as const, size: `${d}`, diameterIn: d });
const rect = (w: number, h: number) => ({
  shape: "rectangular" as const,
  size: `${w}x${h}`,
  widthIn: w,
  heightIn: h,
});
const conn = (
  index: number,
  to: [number, number] | null,
  size: object,
  kind = "end",
  point = [0, 0, 0],
): Conn =>
  ({
    index,
    kind,
    point,
    direction: "out",
    connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
    ...size,
  }) as Conn;
const node = (id: number, kind: string, extra: object): DuctSnapshot["nodes"][number] =>
  ({
    id,
    kind,
    category: "",
    point: [0, 0, 0],
    groupId: "g1",
    facts: [],
    ...extra,
  }) as unknown as DuctSnapshot["nodes"][number];
const duct = (
  id: number,
  lengthFt: number,
  size: ReturnType<typeof round>,
  polyline: number[][],
  connectors: Conn[],
) =>
  ({
    id,
    kind: "duct",
    curveKind: "line",
    ...size,
    lengthFt,
    polyline,
    groupId: "g1",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors,
  }) as unknown as DuctSnapshot["segments"][number];

const snapshot = {
  coordinateEncoding: "native-double",
  document: { title: "t", readAt: "2026-10-04T00:00:00Z", elapsedMs: 1 },
  levels: [],
  groups: [
    {
      id: "g1",
      rootIds: [100],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 2,
      elementCount: 7,
      loops: 0,
      issueIds: [],
    },
  ],
  nodes: [
    node(100, "equipment", { groupId: null, connectors: [conn(0, [1, 0], round(8))] }),
    node(2, "fitting", {
      partType: "Elbow",
      connectors: [conn(0, [1, 1], round(8)), conn(1, [3, 0], round(8))],
      facts: [{ key: "rOverD", value: 1, unit: "", provenance: "geometry" }],
    }),
    node(4, "fitting", {
      partType: "TapAdjustable",
      connectors: [conn(0, [3, 2], round(6), "curve"), conn(1, [7, 0], round(6))],
      facts: [{ key: "mainSegment", value: 3, unit: "", provenance: "geometry" }],
    }),
    node(5, "fitting", {
      partType: "Transition",
      connectors: [{ ...conn(0, [3, 1], round(8)), direction: "in" }, conn(1, [6, 0], rect(12, 4))],
      facts: [{ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" }],
    }),
    node(6, "terminal", {
      terminalDrop: { catalogDropInWg: 0.05, writable: false },
      connectors: [conn(0, [5, 1], rect(12, 4))],
      facts: [{ key: "flow", value: 200, unit: "cfm", provenance: "designer-stated" }],
    }),
    node(8, "terminal", {
      terminalDrop: {
        assignedPressureDropInWg: 0.08,
        connectorLossMethod: "SpecificLoss",
        writable: true,
      },
      connectors: [conn(0, [7, 1], round(6))],
      facts: [{ key: "flow", value: 100, unit: "cfm", provenance: "designer-stated" }],
    }),
  ],
  segments: [
    duct(
      1,
      10,
      round(8),
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [conn(0, [100, 0], round(8), "end", [0, 0, 0]), conn(1, [2, 0], round(8), "end", [10, 0, 0])],
    ),
    duct(
      3,
      12,
      round(8),
      [
        [10, 0, 0],
        [10, 12, 0],
      ],
      [
        conn(0, [2, 1], round(8), "end", [10, 0, 0]),
        conn(1, [5, 0], round(8), "end", [10, 12, 0]),
        conn(2, [4, 0], round(6), "curve", [10, 5, 0]),
      ],
    ),
    duct(
      7,
      3,
      round(6),
      [
        [10, 5, 0],
        [10, 5, 3],
      ],
      [conn(0, [4, 1], round(6)), conn(1, [8, 0], round(6))],
    ),
  ],
  flows: [],
  issues: [],
  layers: [],
} as unknown as DuctSnapshot;

// Expected, computed independently (Python, same grids, handcalc.py arithmetic):
//  common  duct 1 (8 in, 10 ft, 300 cfm) 0.0152039 + elbow CD3-2 D=8 C .24 x Pv(300 cfm) 0.0110481
//          + duct 3 upstream (5 ft, 300 cfm) 0.0076020                        = 0.0338540
//  T6      tap straight SD5-9 Cs(.6667, 1) .13667 x Pv(200 cfm) 0.0027961 + duct 3 (7 ft, 200 cfm)
//          0.0051079 + SR4-3 (45, Ao/A1 .95493) x Pv(600 fpm) 0.0001213 + Ps .05 = 0.0918793
//  T8      tap branch SD5-9 Cb(.3333, .5625) 3.15333 x Pv(509 fpm) 0.0509751 + duct 7 (6 in, 3 ft,
//          100 cfm) 0.0025375 + Ps .08                                        = 0.1673666
const T6 = 0.09187933;
const T8 = 0.16736657;

it("measures root-duct taps from the equipment port regardless of curve storage direction", () => {
  const rooted = structuredClone(snapshot);
  rooted.nodes = rooted.nodes.filter((n) => n.id !== 2);
  rooted.segments = rooted.segments.filter((s) => s.id !== 1);
  rooted.nodes.find((n) => n.id === 100)!.connectors = [conn(7, [3, 0], round(8))];
  const main = rooted.segments.find((s) => s.id === 3)!;
  main.connectors.find((c) => c.index === 0)!.connectedTo = { elementId: 100, connector: 7 };
  const forward = computeLosses(rooted, grids);
  const common = friction(roundSection(8), 300, 5, 0.0003).dp;
  const branch = forward.paths[8]!;
  expect(branch.rows.find((r) => r.id === 3 && r.kind === "friction")!.dp).toBeCloseTo(common, 12);
  main.polyline.reverse();
  const reversed = computeLosses(rooted, grids);
  expect(reversed).toEqual(forward);
});

it("solves a synthetic network end to end", () => {
  const r = computeLosses(snapshot, grids);
  expect(r.errors).toEqual([]);
  expect(r.paths[6]!.total).toBeCloseTo(T6, 7);
  expect(r.paths[8]!.total).toBeCloseTo(T8, 7);
  expect(r.fan).toBeCloseTo(T8, 7);
  expect(r.critical).toBe(8);
  expect(r.paths[6]!.rows.map((x) => x.kind)).toEqual([
    "friction",
    "fitting",
    "friction",
    "tap-straight",
    "friction",
    "fitting",
    "terminal",
  ]);
  expect(r.paths[8]!.rows.map((x) => x.kind)).toEqual([
    "friction",
    "fitting",
    "friction",
    "tap-branch",
    "friction",
    "terminal",
  ]);
  expect(r.paths[8]!.rows[3]).toMatchObject({ rule: "tap-std", leg: "Cb", table: "SD5-9" });
  expect(r.paths[8]!.rows[3]!.c).toBeCloseTo(3.15333, 4);
  expect(r.byRule["elbow-1d-le10"]!.critical).toBeCloseTo(0.0110481, 6);
  expect(r.byRule["tap-std"]!.instances).toBe(1);
});

it("honours overrides and reports a missing table", () => {
  const r = computeLosses(
    snapshot,
    grids,
    {},
    { terminalPs: { 8: 0.1 }, componentDrop: { 2: 0.5 } },
  );
  expect(r.paths[8]!.total).toBeCloseTo(T8 - 0.08 + 0.1 - 0.0110481 + 0.5, 6);
  const missing = computeLosses(snapshot, grids, { "elbow-1d-le10": "CD3-9" });
  expect(missing.errors).toEqual([
    expect.objectContaining({ id: 2, rule: "elbow-1d-le10", table: "CD3-9" }),
  ]);
});

it("prices a tap entered from its main as a takeoff, and one entered from the collar as its branch turn", () => {
  const main = computeLosses(snapshot, grids).paths[8]!.rows.find((x) => x.id === 4)!;
  expect(main.error).toBeUndefined();
  expect(main.c).toBeGreaterThan(0);

  // Same parts, fed through the collar: unit 100 -> duct 7 (6 in) -> tap 4 -> duct 3 -> 5 -> grille 6.
  const flipped = structuredClone(snapshot);
  flipped.nodes = flipped.nodes.filter((n) => [100, 4, 5, 6].includes(n.id));
  flipped.segments = flipped.segments.filter((x) => x.id === 3 || x.id === 7);
  flipped.nodes[0]!.connectors = [conn(0, [7, 1], round(6))];
  flipped.segments.find((x) => x.id === 3)!.connectors[0]!.connectedTo = null;
  flipped.segments.find((x) => x.id === 7)!.connectors[1] = conn(1, [100, 0], round(6));
  const r = computeLosses(flipped, grids);
  const row = r.paths[6]!.rows.find((x) => x.id === 4)!;
  // All of the air turns through it: SD5-9 Cb at Qb/Qc = 1, and the row names the assumption.
  expect(row).toMatchObject({ kind: "tap-branch", rule: "tap-std", inputs: { x: 1 } });
  expect(row.error).toBeUndefined();
  expect(row.c).toBeGreaterThan(0);
  expect(row.notes).toContain("entered from the collar: priced as its branch turn at Qb/Qc = 1");
});

it("fanout moves only the terminals whose path crosses the rule", () => {
  // The grille transition sits on terminal 6 only; a stand-in SR4-1 grid lowers its C.
  const half: Grid = {
    title: "stand-in",
    xLabel: "Theta",
    yLabel: "Ao/A1",
    x: [10, 180],
    y: [0.1, 16],
    grid: [
      [0.001, 0.001],
      [0.001, 0.001],
    ],
  };
  const withHalf: Grids = { ...grids, "SR4-1": { Co: half } };
  const f = fanout(snapshot, withHalf, {}, "trx-grille", "SR4-1");
  expect(f.movedTerminals).toEqual([6]);
  expect(f.instances).toBe(1);
  expect(f.after.paths[8]!.total).toBe(f.before.paths[8]!.total);
  expect(f.after.paths[6]!.total).toBeLessThan(f.before.paths[6]!.total);
  expect(() => fanout(snapshot, withHalf, {}, "trx-grille", "CD3-2")).toThrow();
  // The tap rule is crossed by both paths (branch leg on 8, straight leg on 6).
  const scale = (g: Grid): Grid => ({
    ...g,
    grid: (g.grid as number[][]).map((r) => r.map((v) => v * 2)),
  });
  const sd10 = { Cb: scale(grids["SD5-9"]!.Cb!), Cs: scale(grids["SD5-9"]!.Cs!) };
  const tapped = fanout(snapshot, { ...grids, "SD5-10": sd10 }, {}, "tap-std", "SD5-10");
  expect([...tapped.movedTerminals].sort((a, b) => a - b)).toEqual([6, 8]);
  expect(tapped.instances).toBe(1);
});

it("runs the whole pipeline over W1's synthetic snapshot", () => {
  // Expected from the same grids and handcalc.py arithmetic, computed independently:
  //  T30  duct 10 (12 in, 10 ft, 400 cfm) 0.0035563 + tap straight SD5-9 Cs(.75, 1) .125 x Pv(300 cfm)
  //       0.0011366 + duct 10 (10 ft, 300 cfm) 0.0021239 + elbow CD3-21 D=12 .29 x Pv 0.0026370
  //       + duct 11 (10 ft, 300 cfm) 0.0021239 + terminal assigned 0                  = 0.0115778
  //  T31  duct 10 0.0035563 + tap branch SD5-9 Cb(.25, abOverAc .25) 1.38 x Pv(100 cfm in 6 in)
  //       0.0223083 + duct 12 (6 in, 7.5 ft, 100 cfm) 0.0063438 + terminal 0.05       = 0.0822084
  const snap = synthetic as unknown as DuctSnapshot;
  const r = computeLosses(snap, grids);
  expect(r.errors).toEqual([]);
  expect(r.paths[30]!.total).toBeCloseTo(0.01157782, 7);
  expect(r.paths[31]!.total).toBeCloseTo(0.08220842, 7);
  expect(r.critical).toBe(31);
  expect(r.paths[30]!.rows.find((x) => x.rule === "elbow-1d-gt10")).toMatchObject({
    table: "CD3-21",
  });
  expect(systemFor(snap, 31)?.id).toBe(500);
  expect(r.byGroup.g10).toMatchObject({ critical: 31, revitCritical: 0.1 });
  // No grids loaded: every priced fitting reports it, nothing throws.
  expect(computeLosses(snap, {}).errors.length).toBeGreaterThan(0);
});

it("narrows a ducts.tables response and reads a constant table", () => {
  const g = toGrids({
    tables: {
      "cd9-1": { Co: { title: "const", xLabel: "x", x: [], grid: [0.12] } },
      "cd3-2": { Co: { title: "t", xLabel: "D", x: [3, 4], grid: [0.44, 0.37] } },
    },
  });
  expect(lookupGrid(g["CD9-1"]!.Co!, 99).value).toBe(0.12);
  expect(lookupGrid(g["CD3-2"]!.Co!, 3.5).value).toBeCloseTo(0.405, 6);
  expect(() =>
    toGrids({ tables: { A: { Co: { title: "t", x: [1], y: [1, 2], grid: [[1]] } } } }),
  ).toThrow();
});

it("prices under the table a person staged in the Work document", () => {
  // The staged cell goes through the route contract, then becomes the solver's choices.
  const doc = ductsRouteState.schema.parse({
    rules: { "elbow-1d-gt10": { staged: { value: { table: "CD3-2" } } } },
  });
  const choices = Object.fromEntries(
    Object.entries(stagedDucts(doc).rules).map(([key, v]) => [key, v.table]),
  );
  const r = computeLosses(synthetic as unknown as DuctSnapshot, grids, choices);
  const elbow = r.paths[30]!.rows.find((x) => x.rule === "elbow-1d-gt10")!;
  expect(elbow).toMatchObject({
    table: "CD3-2",
    c: 0.24,
    inputs: { res: "Co", x: 12, xLabel: "D", notes: ["D clamped at 10"] },
  });
  const tap = r.paths[31]!.rows.find((x) => x.kind === "tap-branch")!;
  expect(tap.inputs).toMatchObject({ res: "Cb", xLabel: "Qb/Qc", yLabel: "Ab/Ac", y: 0.25 });
});

it("prices once per snapshot: a Work change reuses the applied solve and answers as a fresh solve would", () => {
  const snap = structuredClone(synthetic) as unknown as DuctSnapshot;
  const key = "elbow-1d-gt10";
  const doc = ductsRouteState.schema.parse({
    rules: { [key]: { staged: { value: { table: "CD3-2" } } } },
  });
  const unstaged = price(snap, grids, null);
  const staged = price(snap, grids, doc);
  expect(staged.now).toBe(unstaged.now);
  expect(price(snap, grids, doc)).toBe(staged);
  expect(staged.next).toEqual(computeLosses(snap, grids, staged.choices, staged.overrides));
  // A different snapshot object is a different solve.
  expect(price(structuredClone(snap), grids, doc).now).not.toBe(staged.now);

  const f = stagedFanout(snap, grids, staged, key)!;
  expect(stagedFanout(snap, grids, unstaged, key)).toBeNull();
  expect(stagedFanout(snap, grids, staged, key)).toBe(f);
  expect(f).toEqual(fanout(snap, grids, staged.applied, key, "CD3-2"));
  expect(groupTree(snap, "g10")).toBe(groupTree(snap, "g10"));
});

it("the scene carries Pe's loss per element, counting the rows paths share once", () => {
  const snap = synthetic as unknown as DuctSnapshot;
  const priced = price(snap, grids, null);
  const rows = (terminal: number, id: number) =>
    priced.now.paths[terminal]!.rows.filter((row) => row.id === id);
  const sum = (list: { dp: number | null }[]) => list.reduce((a, row) => a + (row.dp ?? 0), 0);
  const losses = lossesOf(priced.now);
  // Duct 10 is walked by both paths and tapped once: its first interval is the same row on each
  // path, its second belongs to the path that carries on. Summing every path would count the
  // first interval twice.
  expect(rows(30, 10)).toHaveLength(2);
  expect(rows(31, 10)).toHaveLength(1);
  expect(losses.get(10)).toBeCloseTo(sum(rows(30, 10)), 9);
  expect(losses.get(10)).toBeLessThan(sum(rows(30, 10)) + sum(rows(31, 10)) - 1e-6);
  // A tap's straight and branch legs are alternatives: the larger one shows.
  expect(losses.get(22)).toBeCloseTo(0.0223083, 6);
  expect(losses.get(31)).toBeCloseTo(0.05, 9);
  // An element no priced path crosses has no loss, not zero.
  expect(losses.has(1)).toBe(false);

  const scene = sceneOf(indexOf(snap, priced), "g10", () => true);
  const duct = scene.segments.find((facts) => facts.segment.id === 10)!;
  expect(duct.pressure?.drop).toBeCloseTo(losses.get(10)!, 9);
  expect(scene.nodes.find((facts) => facts.node.id === 22)?.pressure?.drop).toBeCloseTo(
    0.0223083,
    6,
  );
  // Unpriced (no tables read yet) the scene draws without loss, and the other groups stay context.
  expect(sceneOf(indexOf(snap), "g10", () => true).segments.every((f) => !f.pressure)).toBe(true);
  expect(sceneOf(indexOf(snap, priced), "", () => true).context.flat()).toHaveLength(3);
});

it.each(rootAttached.cases)(
  "resolves the exact root attachment of retained fitting $fitting.id",
  (captured) => {
    for (const reverse of [false, true]) {
      const fitting = structuredClone(captured.fitting) as DuctSnapshot["nodes"][number];
      const equipment = structuredClone(captured.equipment) as DuctSnapshot["nodes"][number];
      const terminalId = 900000001;
      fitting.groupId = "root-regression";
      const outlet = fitting.connectors.find((port) => port.index === captured.outletIndex)!;
      outlet.connectedTo = { elementId: terminalId, connector: 0 };
      equipment.connectors = equipment.connectors.filter(
        (port) => port.index === captured.rootEquipmentPort,
      );
      if (reverse) fitting.connectors.reverse();
      const snap: DuctSnapshot = {
        ...structuredClone(snapshot),
        groups: [
          {
            id: fitting.groupId,
            rootIds: [equipment.id],
            classifications: ["SupplyAir"],
            systemNames: ["regression"],
            terminalCount: 1,
            elementCount: 2,
            loops: 0,
            issueIds: [],
          },
        ],
        nodes: [
          equipment,
          fitting,
          node(terminalId, "terminal", {
            groupId: fitting.groupId,
            connectors: [
              {
                ...outlet,
                index: 0,
                connectedTo: { elementId: fitting.id, connector: outlet.index },
              },
            ],
            facts: [{ key: "flow", value: 100, unit: "cfm", provenance: "designer-stated" }],
            terminalDrop: { catalogDropInWg: 0, writable: false },
          }),
        ],
        segments: [],
        systems: [],
        flows: [],
        issues: [],
      };
      const root = groupTree(snap, fitting.groupId).root!;
      expect(root).toEqual({
        equipment: equipment.id,
        port: captured.rootEquipmentPort,
        element: fitting.id,
      });
      const inlet = fitting.connectors.find(
        (port) =>
          port.connectedTo?.elementId === root.equipment &&
          port.connectedTo.connector === root.port,
      )!;
      const inletSection = sectionOf(inlet.shape, inlet.diameterIn, inlet.widthIn, inlet.heightIn)!;
      const outletSection = sectionOf(
        outlet.shape,
        outlet.diameterIn,
        outlet.widthIn,
        outlet.heightIn,
      )!;
      expect(inlet.index).toBe(captured.inletIndex);
      expect(outletSection.areaFt2 / inletSection.areaFt2).toBeCloseTo(captured.ratio, 12);
      const result = computeLosses(snap, grids);
      const row = result.paths[terminalId]!.rows.find((row) => row.id === fitting.id)!;
      if (fitting.id === 12398836) {
        expect(row.error).toContain("measured included angle");
        // Explicit manual test angle overlays the retained geometry; it is not a native observation.
        fitting.facts.push({ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" });
        const physical = computeLosses(snap, grids).paths[terminalId]!.rows.find(
          (r) => r.id === fitting.id,
        )!;
        expect(physical.error).toBeUndefined();
        expect(physical.table).toBe("SD4-2");
        expect(physical.inputs?.y).toBeCloseTo((Math.PI * 100) / 576, 12);
        expect(physical.c).toBeCloseTo(0.05455015305021264, 12);
        const contradictory = structuredClone(snap);
        contradictory.nodes
          .find((n) => n.id === fitting.id)!
          .connectors.forEach((c) => {
            c.direction = "in";
          });
        // No In/Out pair: the tree walk orients it, and the row says so (tolerance over repair).
        expect(
          computeLosses(contradictory, grids).paths[terminalId]!.rows.find(
            (r) => r.id === fitting.id,
          )!.notes,
        ).toContain("oriented by the tree walk; its connectors state no In/Out pair");
      } else {
        // Attachment truth is retained; these grids carry no rectangular tables.
        expect(row.error).toBeDefined();
        expect(row.dp).toBe(0);
      }
    }
  },
);

// The manual angle below is an explicit test input, not an observation added to retained Chadds.
it("orients a transition by the tree walk only when its connectors state no In/Out pair, and never assumes an angle", () => {
  const missingAngle = structuredClone(snapshot);
  const trx = missingAngle.nodes.find((n) => n.id === 5)!;
  trx.connectors[0]!.direction = "in";
  trx.connectors[1]!.direction = "out";
  trx.facts = [];
  const row = () => computeLosses(missingAngle, grids).paths[6]!.rows.find((r) => r.id === 5)!;
  expect(row().error).toContain("measured included angle");
  trx.facts = [{ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" }];
  trx.connectors[0]!.direction = "out";
  expect(row().error).toBeUndefined();
  expect(row().notes).toContain("oriented by the tree walk; its connectors state no In/Out pair");
});

it.each(physicalTransitions.nodes)(
  "uses retained transition $id physical directions independently of its non-root walk",
  (captured) => {
    const fitting = structuredClone(captured) as DuctSnapshot["nodes"][number];
    fitting.groupId = "g1";
    fitting.facts = [{ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" }];
    fitting.connectors[0]!.connectedTo = { elementId: 1, connector: 1 };
    fitting.connectors[1]!.connectedTo = { elementId: 6, connector: 0 };
    const network = structuredClone(snapshot);
    network.groups[0]!.terminalCount = 1;
    network.nodes = [
      network.nodes.find((n) => n.id === 100)!,
      fitting,
      network.nodes.find((n) => n.id === 6)!,
    ];
    network.nodes.find((n) => n.id === 6)!.connectors[0]!.connectedTo = {
      elementId: fitting.id,
      connector: fitting.connectors[1]!.index,
    };
    network.segments = [network.segments.find((s) => s.id === 1)!];
    network.segments[0]!.connectors[1]!.connectedTo = {
      elementId: fitting.id,
      connector: fitting.connectors[0]!.index,
    };
    const row = () =>
      computeLosses(network, grids).paths[6]!.rows.find((r) => r.id === fitting.id)!;
    if (fitting.id === 12809620) {
      expect(row().error).toBeUndefined();
      expect(row().table).toBe("SR4-3");
      expect(row().inputs?.y).toBeCloseTo(4 / Math.PI, 12);
      fitting.connectors.reverse();
      expect(row().inputs?.y).toBeCloseTo(4 / Math.PI, 12);
    } else {
      // The walk orients it onto a rule; these grids carry no rectangular table to price it.
      expect(row().rule).toBeDefined();
      expect(row().error).toContain("is not loaded");
    }
  },
);
