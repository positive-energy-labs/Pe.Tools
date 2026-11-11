import { describe, expect, it } from "vite-plus/test";

import { lossGroups } from "./loss-breakdown.ts";
import type { Row } from "./losses.ts";
import { connOf, ductOf, nodeOf, snapshotOf } from "./test-snapshot.ts";

const snapshot = snapshotOf({
  nodes: [
    nodeOf(1, "equipment", { family: "AHU", type: "Coil" }),
    nodeOf(20, "fitting", {
      family: "Elbow",
      type: "Radius",
      connectors: [connOf(0, null, { size: '12"ø' })],
    }),
    nodeOf(21, "fitting", {
      family: "Elbow",
      type: "Radius",
      connectors: [connOf(0, null, { size: '8"ø' })],
    }),
    nodeOf(30, "terminal", { family: "Grille", type: "G1" }),
  ],
  segments: [
    ductOf(10, { type: "Round Duct", size: '12"ø' }),
    ductOf(11, { type: "Round Duct", size: '8"ø' }),
  ],
});
const row = (id: number, kind: Row["kind"], dp: number | null): Row =>
  ({ id, kind, dp, desc: "" }) as Row;
const rows = [
  row(1, "fitting", 0.01),
  row(10, "friction", 0.03),
  row(11, "friction", 0.02),
  row(20, "fitting", 0.04),
  row(21, "fitting", null),
  row(30, "terminal", 0.05),
];

describe("lossGroups", () => {
  it("groups by type, not size, in bar order with the largest first", () => {
    const groups = lossGroups(snapshot, rows);
    expect(groups.map((g) => [g.part, g.label])).toEqual([
      ["unit", "AHU Coil"],
      ["duct", "Round Duct"],
      ["duct", "Elbow Radius"],
      ["terminal", "Grille G1"],
    ]);
    const duct = groups.find((g) => g.label === "Round Duct")!;
    expect(duct.dp).toBeCloseTo(0.05);
    expect(duct.ids).toEqual([10, 11]);
    expect(groups.find((g) => g.label === "Elbow Radius")!.unpriced).toBe(1);
    expect(groups.reduce((a, g) => a + g.dp, 0)).toBeCloseTo(0.15);
  });
  it("splits by size only when asked", () => {
    const labels = lossGroups(snapshot, rows, { bySize: true }).map((g) => g.label);
    expect(labels).toContain('Round Duct 12"ø');
    expect(labels).toContain('Round Duct 8"ø');
  });
});
