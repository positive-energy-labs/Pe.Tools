import { neutralFansWork } from "@pe/agent-contracts";
import { designOf } from "@pe/ducts-domain/test-design";
import { expect, test } from "vite-plus/test";
import { price } from "@pe/ducts-domain/pricing";
import { systemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import saved from "./fixtures/synthetic-snapshot.json";
import { systemList } from "./system-list";
import { fanFacts } from "./proto/e/fan-sections";
import { buildTree } from "./proto/b/model";

test("F16 metadata-only roster exposes system information before network pricing", () => {
  const snapshot = structuredClone(saved) as DuctSnapshot;
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

test("two systems sharing a fan retain their own pressure and breakdown terminal", () => {
  const snapshot = structuredClone(saved) as DuctSnapshot;
  snapshot.groups[0]!.systemNames.push("SA 2");
  snapshot.systems.push({ ...snapshot.systems[0]!, id: 501, name: "SA 2" });
  for (const e of [...snapshot.nodes, ...snapshot.segments])
    if ([12, 22, 31].includes(e.id)) e.systemName = "SA 2";
  const cell = (inWg: number) => ({ edit: { value: { inWg } } });
  const work = designOf({
    terminalDrops: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-0000001e": cell(0.05), "UniqueId:6d52156a-3876-4d76-b641-341454252f26-0000001f": cell(0.35) },
    componentDrops: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000015": cell(0.01), "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000016": cell(0.01) },
  });
  const priced = price(snapshot, {}, work, (work) ?? neutralFansWork);
  const rows = systemList(priced.snapshot, priced);
  expect(rows.map((r) => r.key)).toEqual(["SA 1", "SA 2"]);
  expect(rows[0]!.total).toBeLessThan(rows[1]!.total!);
  expect(rows[0]!.split!.rows.some((r) => r.id === 30)).toBe(true);
  expect(rows[0]!.split!.rows.some((r) => r.id === 31)).toBe(false);
  const scope = systemScope(priced.snapshot, "SA 1");
  const facts = fanFacts(priced, scope.groups, String, scope.terminals);
  expect(facts[0]!.esp).toBe(rows[0]!.total);
  const tree = buildTree(priced.snapshot, priced, work, scope.groups, undefined, scope.members);
  expect(tree.flatMap((t) => t.children).map((r) => r.terminal)).toEqual([30]);
});
