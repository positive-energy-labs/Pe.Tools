import { expect, test } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import { price } from "@pe/ducts-domain/pricing";
import { systemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import saved from "./fixtures/synthetic-snapshot.json";
import { systemList } from "./system-list";
import { fanFacts } from "./proto/e/fan-sections";
import { buildTree } from "./proto/b/model";

test("two systems sharing a fan retain their own pressure and breakdown terminal", () => {
  const snapshot = structuredClone(saved) as DuctSnapshot;
  snapshot.groups[0]!.systemNames.push("SA 2");
  snapshot.systems.push({ ...snapshot.systems[0]!, id: 501, name: "SA 2" });
  for (const e of [...snapshot.nodes, ...snapshot.segments])
    if ([12, 22, 31].includes(e.id)) e.systemName = "SA 2";
  const cell = (inWg: number) => ({ edit: { value: { inWg } } });
  const work = ductsRouteState.schema.parse({
    terminalDrops: { 30: cell(0.05), 31: cell(0.35) },
    componentDrops: { 21: cell(0.01), 22: cell(0.01) },
  });
  const priced = price(snapshot, {}, work);
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
