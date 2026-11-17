import { expect, test } from "vite-plus/test";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { syntheticSnapshot } from "./test-fixture";
import { systemList } from "./system-list";
import { fanFacts } from "./proto/e/fan-sections";
import { buildSheetTree, runNodesOf } from "./proto/b/sheet-model";
import { calcsOf, withFan } from "./calcs.test-support";

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
  const scope = systemScope(snapshot, "SA 2");
  const facts = fanFacts({ calcs } as never, scope.terminals);
  // The fan's calc is not complete on this capture (it has no return path), so no ESP is claimed.
  expect(facts.map((f) => [f.unit, f.complete, f.claim])).toEqual([[1, false, "incomplete"]]);
  const tree = buildSheetTree(snapshot, calcs, scope.groups, scope.members);
  expect(runNodesOf(tree).map((r) => r.terminal)).toEqual([31, 30]);
  expect(tree[0]!.children[0]!.name).toContain("full fan sheet");
});

test("a system no fan calc reaches is fanless and its tree says to rule a fan (L2-4)", () => {
  const snapshot = syntheticSnapshot();
  const calcs = calcsOf(snapshot);
  expect(calcs).toEqual([]);
  expect(systemList(snapshot, calcs)[0]).toMatchObject({ fanless: true, total: null });
  expect(buildSheetTree(snapshot, calcs)[0]!.message).toBe("Rule a fan to price this system");
});
