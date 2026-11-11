// U4 wires the real fans Work for callers without one.
import { neutralFansWork } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import { bin } from "./bins.ts";
import type { Grids } from "./loss-grid.ts";
import { computeLosses, IMPLAUSIBLE_ROW_IN_WG } from "./losses.ts";
import { price } from "./pricing.ts";
import {
  connOf,
  ductOf,
  factOf,
  groupOf,
  nodeOf,
  round,
  snapshotOf as snapshot,
  type Connector,
  type Fact,
  type Node,
  type Segment,
} from "./test-snapshot.ts";

const port = (index: number, to: number | null, connector = 1, classification = "SupplyAir") =>
  connOf(index, to == null ? null : [to, connector], {
    ...round(12),
    point: [0, 0, 9],
    classification,
    areaFt2: 0.7854,
  });
const fact = (key: string, value: number | null) => factOf(key, value);
const node = (
  id: number,
  kind: Node["kind"],
  connectors: Connector[],
  facts: Fact[] = [],
  classification = "Supply Air",
  partType: string | null = kind === "fitting" ? "Tee" : null,
) =>
  nodeOf(id, kind, {
    family: kind,
    type: "Standard",
    partType,
    levelId: 100,
    point: [0, 0, 9],
    groupId: kind === "equipment" ? null : "g10",
    systemName: "SA",
    classification,
    connectors,
    facts,
  });
const duct = (id: number, ends: [number, number], classification = "Supply Air") =>
  ductOf(id, {
    type: "Round Duct",
    ...round(12),
    lengthFt: 10,
    polyline: [
      [0, 0, 9],
      [10, 0, 9],
    ],
    levelId: 100,
    groupId: "g10",
    systemName: "SA",
    classification,
    connectors: [port(1, ends[0]), port(2, ends[1])],
  });
const snapshotOf = (nodes: Node[], segments: Segment[], classifications: string[]) =>
  snapshot({
    groups: [
      groupOf("g10", {
        rootIds: [1],
        classifications,
        systemNames: ["SA"],
        terminalCount: 1,
        elementCount: nodes.length + segments.length,
      }),
    ],
    nodes,
    segments,
  });

// SD5-9's small Ab/Ac row is steep (the real table gives 670 at Ab/Ac 0.0428); a flat grid stands in.
const grids: Grids = {
  "SD5-9": {
    Cb: {
      title: "Cb",
      xLabel: "Qb/Qc",
      x: [0, 1],
      yLabel: "Ab/Ac",
      y: [0.01, 1],
      grid: [
        [670, 670],
        [670, 670],
      ],
    },
    Cs: {
      title: "Cs",
      xLabel: "Qs/Qc",
      x: [0, 1],
      yLabel: "Ab/Ac",
      y: [0.01, 1],
      grid: [
        [0.1, 0.1],
        [0.1, 0.1],
      ],
    },
  },
};

/** Equipment 1 feeds duct 10 into takeoff 50 by its collar; the takeoff's main (duct 11, capped) ends at grille 30. */
const collarSnapshot = () =>
  snapshotOf(
    [
      node(1, "equipment", [port(1, 10)], [fact("fanFlow", 400)]),
      node(
        50,
        "fitting",
        [port(1, 10, 2), port(2, 11)],
        [fact("takeoff", 1), fact("mainSegment", 11), fact("abOverAc", 0.0428)],
        "Supply Air",
        "Tap",
      ),
      node(30, "terminal", [port(1, 11, 2)], [fact("flow", 400)]),
    ],
    [duct(10, [1, 50]), duct(11, [50, 30])],
    ["Supply Air"],
  );

describe("implausible loss", () => {
  it("stops a collar entry at Qb/Qc = 1 with a small Ab/Ac, and the system does not price", () => {
    const r = computeLosses(collarSnapshot(), grids);
    const row = r.paths[30]!.rows.find((x) => x.implausible);
    expect(row).toMatchObject({
      id: 50,
      rule: "tap-std",
      table: "SD5-9",
      dp: 0,
      c: 670,
      implausible: { res: "Cb", cfm: 400, reasons: expect.arrayContaining(["drop"]) },
    });
    expect(670).toBeGreaterThan(IMPLAUSIBLE_ROW_IN_WG);
    expect(row!.error).toContain("tap-std");
    expect(row!.error).toContain("SD5-9");
    expect(row!.error).toContain("400 cfm");
    expect(r.errors.some((e) => e.id === 50 && e.rule === "tap-std")).toBe(true);
    expect(r.byGroup.g10!.implausible).toEqual([50]);
    expect(r.byGroup.g10!.fan).toBeNull();
    // The absurd 670 x Pv never reaches the path total.
    expect(r.paths[30]!.rows.some((x) => (x.dp ?? 0) > 100)).toBe(false);
  });

  it("raises a blocking implausible-loss finding naming the element, rule, table and flow", () => {
    const priced = price(collarSnapshot(), grids, null, neutralFansWork);
    const found = priced.findings.filter((f) => f.kind === "implausible-loss");
    expect(found).toHaveLength(1);
    expect(found[0]!.elementIds).toEqual([50]);
    expect(found[0]!.note).toMatch(/Cb 670.*SD5-9|SD5-9.*Cb 670/);
    expect(bin(found[0]!)).toBe("blocking");
  });
});

describe("cross-classification flow", () => {
  /** Supply grille 31 (100 cfm) and a return grille 32 (500 cfm) welded onto the same tee 50. */
  const welded = () =>
    snapshotOf(
      [
        node(1, "equipment", [port(1, 10)], [fact("fanFlow", 100)]),
        node(50, "fitting", [port(1, 10, 2), port(2, 11), port(3, 12)]),
        node(31, "terminal", [port(1, 11, 2)], [fact("flow", 100)]),
        node(32, "terminal", [port(1, 12, 2, "ReturnAir")], [fact("flow", 500)], "Return Air"),
      ],
      [duct(10, [1, 50]), duct(11, [50, 31]), duct(12, [50, 32], "Return Air")],
      ["Supply Air", "Return Air"],
    );

  it("keeps a return terminal's flow off the supply trunk and marks the element", () => {
    const r = computeLosses(welded(), {});
    const trunk = r.paths[31]!.rows.find((x) => x.kind === "friction" && x.id === 10)!;
    // 12 in round is 0.7854 ft2: 100 cfm reads 127 fpm; with the welded 500 cfm it would read 764.
    expect(trunk.fpm).toBeCloseTo(100 / 0.7854, 0);
    expect(r.crossClass).toEqual([expect.objectContaining({ id: 50, from: 12, cfm: 500 })]);
    const found = price(welded(), {}, null, neutralFansWork).now.crossClass;
    expect(found).toHaveLength(1);
  });

  it("raises mixed-classification on the element", () => {
    const found = price(welded(), {}, null, neutralFansWork).findings.filter(
      (f) => f.kind === "mixed-classification" && f.elementIds.includes(50),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.note).toContain("500 cfm");
  });
});
