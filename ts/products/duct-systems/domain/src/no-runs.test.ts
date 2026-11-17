import { expect, it } from "vite-plus/test";
import { noRunBranches } from "./no-runs.ts";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { connOf, groupOf, nodeOf, snapshotOf, type Node } from "@pe/ducts-domain/test-snapshot";
import type { CalcRun } from "@pe/ducts-domain/calc-runs";

const part = (id: number, kind: Node["kind"], to: (number | null)[], systemName = "SA 1") =>
  nodeOf(id, kind, {
    groupId: "g",
    systemName,
    point: [id, 0, 0],
    connectors: to.map((elementId, index) =>
      connOf(index, elementId == null ? null : [elementId, 0], { point: [id, 0, 0] }),
    ),
  });
const snapshot = snapshotOf({
  nodes: [
    part(1, "equipment", [2]),
    part(2, "fitting", [1, 3, 4, 7]),
    part(3, "terminal", [2]),
    part(4, "fitting", [2, 5]),
    part(5, "fitting", [4, null]),
    part(7, "fitting", [2, 8]),
    part(8, "cap", [7]),
  ],
  groups: [groupOf("g", { rootIds: [1], systemNames: ["SA 1"] })],
});
// One fan calc path, from unit 1 to grille 3.
const solved = [{ terminal: 3, path: [1, 2, 3] }] as unknown as CalcRun[];
const flows = new Map([[3, { cfm: 100 }]]);

it("leaves the fan-to-terminal trunk clear and groups the open and capped side branches", () => {
  const result = noRunBranches(snapshot, solved, systemScope(snapshot, "SA 1"), flows);
  expect([...result.keys()].sort()).toEqual([4, 5, 7, 8]);
  expect(result.get(4)).toEqual({
    elements: [4, 5],
    reasons: [
      { kind: "open", at: 5, connector: 1, text: expect.stringMatching(/^Ends open at \D+$/) },
    ],
  });
  expect(result.get(7)?.reasons.map((r) => r.kind)).toEqual(["capped"]);
});

it("a zero-flow terminal is no run, and edit positive flow restores its run", () => {
  const scope = systemScope(snapshot, "SA 1");
  const result = noRunBranches(snapshot, solved, scope, new Map([[3, { cfm: 0 }]]));
  expect(result.has(2)).toBe(true);
  expect(result.get(3)?.reasons.some((r) => r.kind === "flowless-terminal")).toBe(true);
  expect(noRunBranches(snapshot, solved, scope, flows).has(3)).toBe(false);
});

it("a foreign terminal does not make a system's branch a run", () => {
  const raw = structuredClone(snapshot);
  raw.nodes.find((n) => n.id === 3)!.systemName = "SA 2";
  const result = noRunBranches(raw, solved, systemScope(raw, "SA 1"), flows);
  expect(result.get(2)?.reasons.some((r) => r.kind === "foreign-terminal" && r.at === 3)).toBe(
    true,
  );
});

it("a run on any fan's calc clears its branch; no calc leaves the whole scope with no run", () => {
  const scope = systemScope(snapshot, "SA 1");
  const none = noRunBranches(snapshot, [], scope, flows);
  expect([...none.keys()].sort()).toEqual([2, 3, 4, 5, 7, 8]);
  const other = solved.map((run) => ({ ...run, path: [9, 2, 3] }));
  expect([...noRunBranches(snapshot, other, scope, flows).keys()].sort()).toEqual([4, 5, 7, 8]);
});
