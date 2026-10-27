/**
 * /ducts loss solver, deterministic. Interpolation is checked on three real ASHRAE grids shipped
 * with Revit (copied to fixtures/ashrae, parsed here by a test-only reader) against the values
 * `.artifacts/pdrop/sa26/ctable.md` lists; friction against handcalc.json; the pipeline on a small
 * synthetic network whose totals were computed independently in Python from the same grids.
 */
import { ductsRouteState, stagedDucts } from "@pe/agent-contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

import { bin } from "@pe/ducts-domain/bins";
import { type Grid, type Grids } from "@pe/ducts-domain/loss-grid";
import { sectionOf } from "@pe/ducts-domain/loss-physics";
import { computeLosses, systemFor } from "@pe/ducts-domain/losses";
import { price } from "@pe/ducts-domain/pricing";
import { groupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import physicalTransitions from "./fixtures/physical-transitions.json";
import rootAttached from "./fixtures/root-attached-fittings.json";
import synthetic from "./fixtures/synthetic-snapshot.json";

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

it("runs the whole pipeline over W1's synthetic snapshot", () => {
  // Expected from the same grids and handcalc.py arithmetic, computed independently:
  //  T30  duct 10 (12 in, 10 ft, 400 cfm) 0.0035563 + tap straight SD5-9 Cs(.75, 1) .125 x Pv(300 cfm)
  //       0.0011366 + duct 10 (10 ft, 300 cfm) 0.0021239 + elbow CD3-21 D=12 .29 x Pv 0.0026370
  //       + duct 11 (10 ft, 300 cfm) 0.0021239 + terminal NotDefined (no drop) = 0.0115778
  //  T31  duct 10 0.0035563 + tap branch SD5-9 Cb(.25, abOverAc .25) 1.38 x Pv(100 cfm in 6 in)
  //       0.0223083 + duct 12 (6 in, 7.5 ft, 100 cfm) 0.0063438 + terminal 0.05       = 0.0822084
  const snap = synthetic as unknown as DuctSnapshot;
  const r = computeLosses(snap, grids);
  // T30's grille holds a NotDefined connector drop (0): no drop is stated, so it is unpriced (the total is unchanged).
  expect(r.errors.map((e) => e.id)).toEqual([30]);
  expect(r.paths[30]!.rows.at(-1)).toMatchObject({ kind: "terminal", dp: null });
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

it("prices under the table a person edit in the Work document", () => {
  // The edit cell goes through the route contract, then becomes the solver's choices.
  const doc = ductsRouteState.schema.parse({
    rules: { "elbow-1d-gt10": { edit: { value: { table: "CD3-2" } } } },
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

/** The synthetic network with grille 30 lifted 0.4 in off duct 11's end, its facing `facing`. */
const lifted = (facing?: number[]) => {
  const broken = structuredClone(synthetic as unknown as DuctSnapshot);
  const end = broken.segments.find((s) => s.id === 11)!.connectors.find((c) => c.index === 2)!;
  const grille = broken.nodes.find((n) => n.id === 30)!;
  end.connectedTo = null;
  grille.connectors[0]!.connectedTo = null;
  grille.point = grille.connectors[0]!.point = [20, 10 + 0.4 / 12, 9];
  if (facing) {
    end.facing = [0, 1, 0];
    grille.connectors[0]!.facing = facing;
  }
  return broken;
};
const JOIN = "proximity:11:2|30:1";
const verdictDoc = (rung: "edit" | "suggestion") =>
  ductsRouteState.schema.parse({
    assumptions: { [JOIN]: { [rung]: { value: { kind: "verdict", verdict: "connect" } } } },
  });

it("only an anomalous join makes a path provisional; a near miss and a stretched join are bridged and final", () => {
  // Facing back down the duct: a near miss, listed, bridged, final.
  const near = price(lifted([0, -1, 0]), grids, null);
  expect(near.findings.find((f) => f.id === JOIN)?.grade).toBe("near-miss");
  expect(bin(near.findings.find((f) => f.id === JOIN)!)).toBe("diagnostic");
  expect(near.next.paths[30]).toMatchObject({ inferred: [JOIN], provisional: null });
  expect(near.next.byGroup.g10!.provisional).toBeNull();
  // No captured facing on the grille: stretched, listed, bridged, and the fan stays final.
  const stretched = price(lifted(), grids, null);
  expect(stretched.findings.find((f) => f.id === JOIN)?.grade).toBe("stretched");
  expect(bin(stretched.findings.find((f) => f.id === JOIN)!)).toBe("diagnostic");
  expect(stretched.next.paths[30]).toMatchObject({ inferred: [JOIN], provisional: null });
  expect(stretched.next.byGroup.g10!.provisional).toBeNull();
  expect(stretched.next.provisional).toBeNull();
  // Facing the same way as the duct's end: one is reversed, anomalous, blocking, and the group's fan and
  // the document's rest on it.
  const anomalous = price(lifted([0, 1, 0]), grids, null);
  const provisional = { worst: "anomalous", count: 1, findingIds: [JOIN] };
  expect(bin(anomalous.findings.find((f) => f.id === JOIN)!)).toBe("blocking");
  expect(anomalous.next.paths[30]!.provisional).toEqual(provisional);
  expect(anomalous.next.paths[31]!.provisional).toBeNull();
  expect(anomalous.next.byGroup.g10!.provisional).toEqual(provisional);
  expect(anomalous.next.provisional).toEqual(provisional);
});

it("only a person's edit connect confirms an anomalous join; Pea's proposed connect leaves it provisional", () => {
  const broken = lifted([0, 1, 0]);
  const edit = price(broken, grids, verdictDoc("edit"));
  // The leftover: a confirmed same-class join no longer counts on the path.
  expect(edit.next.paths[30]).toMatchObject({ inferred: [], provisional: null });
  expect(edit.next.byGroup.g10!.provisional).toBeNull();
  expect(price(broken, grids, verdictDoc("suggestion")).next.paths[30]!.provisional).toMatchObject({
    worst: "anomalous",
    findingIds: [JOIN],
  });
});
