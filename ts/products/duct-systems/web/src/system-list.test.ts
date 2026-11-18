import { expect, test } from "vite-plus/test";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { syntheticSnapshot } from "@pe/ducts-domain/test-fixture";
import { systemList } from "./system-list.ts";
import { fanFacts } from "./screen/fan-sections.tsx";
import { buildCalcTree, runNodesOf } from "./network/calc-model.ts";
import { calcsOf, withFan } from "@pe/ducts-web/calcs.test-support";
import { runsOf } from "@pe/ducts-domain/calc-runs";

test("F16 metadata-only roster exposes system information before network pricing", () => {
  const snapshot = syntheticSnapshot();
  snapshot.groups = [];
  snapshot.segments = [];
  snapshot.systems[0]!.baseEquipmentId = snapshot.nodes.find((node) => node.kind === "equipment")!.id;
  const rows = systemList(snapshot, null);
  expect(rows).toHaveLength(snapshot.systems.length);
  expect(rows[0]).toMatchObject({ name: snapshot.systems[0]!.name, total: null, rating: null, groups: [] });
  expect(rows[0]!.sub).toMatch(/Supply/);
  expect(rows[0]!.sub).toMatch(/terminal/);
  expect(rows[0]!.sub).not.toContain("no fan");
});

test("two systems sharing a fan retain their own worst run and breakdown terminal", () => {
  const snapshot = withFan(syntheticSnapshot());
  snapshot.groups[0]!.systemNames.push("SA 2");
  snapshot.systems.push({ ...snapshot.systems[0]!, id: 501, name: "SA 2" });
  for (const e of [...snapshot.nodes, ...snapshot.segments])
    if ([12, 22, 31].includes(e.id)) e.systemName = "SA 2";
  const calcs = calcsOf(snapshot, {
    endCfm: { 30: 300, 31: 100 },
    drops: { 21: 0.01, 22: 0.01, 30: 0.05, 31: 0.35 },
  });
  const rows = systemList(snapshot, calcs);
  expect(rows.map((r) => r.key)).toEqual(["SA 1", "SA 2"]);
  const second = rows[1]!;
  expect(second.fanless).toBe(false);
  expect(second.total).toBeGreaterThan(0.35);
  // The typed tap drop now prices SA 1's own path, independently of SA 2's.
  expect(rows[0]!.total).toBe(0.077804);
  // P-074: a grille of SA 2 that no fan's calc reaches makes SA 2 unpriced, never priced on grille 31 alone.
  const grille = snapshot.nodes.find((node) => node.id === 31);
  if (!grille) throw Error("The fixture has no grille 31");
  const stranded = {
    ...snapshot,
    nodes: [...snapshot.nodes, { ...grille, id: 99, uniqueId: "stranded-99", connectors: [] }],
  };
  expect([...systemScope(stranded, "SA 2").terminals].sort()).toEqual([31, 99]);
  expect(systemList(stranded, calcs)[1]).toMatchObject({ key: "SA 2", fanless: false, total: null, split: null });
  const scope = systemScope(snapshot, "SA 2");
  const facts = fanFacts({ calcs } as never, scope);
  // The fan's calc is not complete on this capture (it has no return path), so no ESP is claimed.
  expect(facts.map((f) => [f.unit, f.complete, f.claim])).toEqual([[1, false, "incomplete"]]);
  const tree = buildCalcTree(snapshot, calcs, scope.groups, scope.members);
  expect(runNodesOf(tree).map((r) => r.terminal)).toEqual([31, 30]);
  expect(tree[0]!.children[0]!.name).toContain("full fan sheet");
});

test("a system with one unknown path is unpriced, never priced at its worst known run (P-070)", () => {
  const snapshot = withFan(syntheticSnapshot());
  const calcs = calcsOf(snapshot, {
    endCfm: { 30: 300, 31: 100 },
    drops: { 21: 0.01, 22: 0.01, 30: 0.05, 31: 0.35 },
  });
  // Explicitly withhold grille 30: the published fixture's typed tap now prices both paths.
  const path = calcs[0]!.paths.find((p) => p.end.elementId === 30)!;
  calcs[0]!.legs[path.legIds.at(-1)!]!.lossInWg = null;
  expect(runsOf(calcs).map((run) => [run.terminal, run.total == null])).toEqual([
    [31, false],
    [30, true],
  ]);
  expect(systemList(snapshot, calcs)[0]).toMatchObject({ fanless: false, total: null, split: null });
});

test("a system no fan calc reaches is fanless and its tree says to rule a fan (L2-4)", () => {
  const snapshot = syntheticSnapshot();
  const calcs = calcsOf(snapshot);
  expect(calcs).toEqual([]);
  expect(systemList(snapshot, calcs)[0]).toMatchObject({ fanless: true, total: null });
  expect(buildCalcTree(snapshot, calcs)[0]!.message).toBe("Rule a fan to price this system");
});
