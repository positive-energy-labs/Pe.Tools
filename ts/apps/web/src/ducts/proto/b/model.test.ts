/**
 * The profiler tree's math, deterministic: a run's stretches add up to the run's total (a tap the path
 * passes is charged to the main-line element it follows), a stretch that starts at the air mover is
 * named for it (not "open"), and an element a priced path could not price reads as unpriced, never 0.
 */
import { expect, it } from "vite-plus/test";

import type { Priced } from "@pe/ducts-domain/pricing";
import type { Row } from "@pe/ducts-domain/losses";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import synthetic from "../../fixtures/synthetic-snapshot.json";
import { buildTree, rowsByElement, splitOf } from "./model";

const snapshot = synthetic as unknown as DuctSnapshot;
const row = (id: number, dp: number | null, kind: Row["kind"] = "friction"): Row => ({
  id,
  kind,
  dp,
  desc: `row ${id}`,
});

it("deals a pass-by tap's row to the main-line element it follows", () => {
  const dealt = rowsByElement([1, 2, 3], [row(1, 0.1), row(-7, 0.02, "tap-straight"), row(1, 0.1), row(2, 0.3)]);
  expect(dealt.get(1)!.map((r) => r.dp)).toEqual([0.1, 0.02, 0.1]);
  expect(dealt.get(2)!.map((r) => r.dp)).toEqual([0.3]);
  expect(dealt.get(3)).toEqual([]);
});

it("a run's stretches add up to its total, and the unpriced grille is no drop, not 0", () => {
  const group = snapshot.groups[0]!;
  const run = runsOf(groupTree(snapshot, group.id))[0]!;
  const second = run.path[1];
  // One 0.001 row per element, a 0.005 pass-by tap after the second, and no drop at the terminal.
  const rows = [
    ...run.path.slice(0, -1).flatMap((id) => [row(id, 0.001), ...(id === second ? [row(-1, 0.005, "tap-straight")] : [])]),
    row(run.terminal, null, "terminal"),
  ];
  const total = rows.reduce((a, r) => a + (r.dp ?? 0), 0);
  const priced = {
    now: {
      byGroup: {},
      paths: { [run.terminal]: { groupId: group.id, total, rows, inferred: [], provisional: null } },
    },
  } as unknown as Priced;
  const node = buildTree(snapshot, priced, null, [group.id])[0]!;
  const runNode = node.children.find((r) => r.terminal === run.terminal)!;

  const last = runNode.children.at(-1)!;
  expect(last.total).toBeCloseTo(total, 9);
  const own = runNode.children.reduce((a, leg) => a + (leg.self ?? 0), 0);
  expect(own).toBeCloseTo(total, 9);

  const grille = last.children.at(-1)!;
  expect(grille.id).toBe(run.terminal);
  expect(grille.self).toBeNull();
  expect(grille.unpriced?.word).toBe("no drop");

  // The first stretch begins at the unit the run leaves, never at an "open" end.
  expect(runNode.children[0]!.name.startsWith("open")).toBe(false);
  expect(runNode.children[0]!.name.split(" → ")[0]).toBe(runNode.name.split(" → ")[0]);
});

it("a run reads in effective feet: stretches add up to its tel, and a duct carries its own rate", () => {
  const group = snapshot.groups[0]!;
  const run = runsOf(groupTree(snapshot, group.id))[0]!;
  const rows = run.path.map((id): Row => ({ ...row(id, 0.002), lengthFt: 20, rate: 0.01, eqFt: 20 }));
  const tel = rows.reduce((a, r) => a + (r.eqFt ?? 0), 0);
  const priced = {
    now: {
      byGroup: {},
      paths: {
        [run.terminal]: {
          groupId: group.id,
          total: 0.002 * rows.length,
          tel,
          rows,
          inferred: [],
          provisional: null,
        },
      },
    },
  } as unknown as Priced;
  const runNode = buildTree(snapshot, priced, null, [group.id])[0]!.children.find(
    (r) => r.terminal === run.terminal,
  )!;
  expect(runNode.ft).toBe(tel);
  expect(runNode.children.at(-1)!.ft).toBeCloseTo(tel, 9);
  expect(runNode.children.reduce((a, leg) => a + (leg.selfFt ?? 0), 0)).toBeCloseTo(tel, 9);
  const element = runNode.children[0]!.children[0]!;
  expect(element.selfFt).toBe(20);
  expect(element.rate).toBeCloseTo((0.002 / 20) * 100, 9);
});

it("splits a run into unit end, ducts and fittings, and grille, and the parts add to the run", () => {
  const rows = [
    { id: 1, kind: "fitting", dp: 0.1, desc: "passive coil" },
    { id: 2, kind: "friction", dp: 0.05, desc: "duct" },
    { id: 3, kind: "fitting", dp: 0.02, desc: "elbow" },
    { id: 2, kind: "friction", dp: 0.01, desc: "duct again" },
    { id: 4, kind: "terminal", dp: 0.08, desc: "grille" },
    { id: 5, kind: "terminal", dp: null, desc: "grille, no drop" },
  ] as Row[];
  const split = splitOf(rows, new Set([1]));
  expect(split.unit).toEqual({ dp: 0.1, ids: [1], unpriced: 0 });
  expect(split.duct.ids).toEqual([2, 3]);
  expect(split.duct.dp).toBeCloseTo(0.08);
  // An unpriced grille is counted, never priced at 0.
  expect(split.terminal).toEqual({ dp: 0.08, ids: [4, 5], unpriced: 1 });
});
