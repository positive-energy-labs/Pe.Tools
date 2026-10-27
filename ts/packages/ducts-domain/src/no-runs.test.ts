import { expect, it } from "vite-plus/test";
import { noRunBranches } from "./no-runs.ts";
import { systemScope } from "./system-scope.ts";
import type { DuctSnapshot } from "./types.ts";
import type { LossResult } from "./losses.ts";

const part = (id: number, kind: string, to: (number | null)[], systemName = "SA 1") => ({
  id,
  kind,
  groupId: "g",
  systemName,
  point: [id, 0, 0],
  facts: [],
  connectors: to.map((elementId, index) => ({
    index,
    kind: "end",
    point: [id, 0, 0],
    connectedTo: elementId == null ? null : { elementId, connector: 0 },
  })),
});
const snapshot = {
  nodes: [
    part(1, "equipment", [2]),
    part(2, "fitting", [1, 3, 4, 7]),
    part(3, "terminal", [2]),
    part(4, "fitting", [2, 5]),
    part(5, "fitting", [4, null]),
    part(7, "fitting", [2, 8]),
    part(8, "cap", [7]),
  ],
  segments: [],
  flows: [],
  issues: [],
  systems: [],
  groups: [{ id: "g", rootIds: [1], systemNames: ["SA 1"], issueIds: [] }],
} as unknown as DuctSnapshot;
const solved = {
  paths: { 3: { path: [2, 3] } },
  byGroup: {},
  crossClass: [],
} as unknown as Pick<LossResult, "paths" | "byGroup" | "crossClass">;
const flows = new Map([[3, { cfm: 100 }]]);

it("leaves the fan-to-terminal trunk clear and groups the open and capped side branches", () => {
  const result = noRunBranches(snapshot, solved, systemScope(snapshot, "SA 1"), flows);
  expect([...result.keys()].sort()).toEqual([4, 5, 7, 8]);
  expect(result.get(4)).toEqual({
    elements: [4, 5],
    reasons: [{ kind: "open", at: 5, text: "Ends open at 5:1" }],
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

it("a classification stop invalidates the run and names the stopped edge", () => {
  const result = noRunBranches(
    snapshot,
    {
      ...solved,
      crossClass: [
        { id: 2, from: 3, classification: "ReturnAir", fromClassification: "SupplyAir", cfm: 100 },
      ],
    },
    systemScope(snapshot, "SA 1"),
    flows,
  );
  expect(result.get(2)?.reasons.some((r) => r.kind === "classification-stop")).toBe(true);
});
