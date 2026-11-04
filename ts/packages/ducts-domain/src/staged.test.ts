import { designOf } from "./test-design.ts";
import { expect, it } from "vite-plus/test";
import { ductsApplyInputSchema } from "@pe/agent-contracts";
import type { DuctsApply } from "@pe/host-contracts/generated";

import { appliedCellPaths, pendingCount, stagedCells, stagedEsp } from "./staged.ts";

const doc = designOf({
  esp: { "100": { edit: { value: { inWg: 0.5 } } } },
  flows: { "4": { edit: { value: { cfm: 100 } } }, "5": {} },
});

it("retires only transmitted successful writes, retaining held ESP and partially refused rules", () => {
  // 07ca5af4: pe-server writes carry the host-priced legs, never native repricing.
  const results = [{ velocityPressureInWg: 0.02, coefficient: 1 }];
  const input = ductsApplyInputSchema.parse({
    fittings: [
      { id: 1, method: "pe-server", coefficient: 1, results, ruleKey: "partial" },
      { id: 2, method: "pe-server", coefficient: 1, results, ruleKey: "partial" },
      { id: 3, method: "pe-server", coefficient: 1, results, ruleKey: "complete" },
    ],
    terminals: [{ id: 4, inWg: 0.1 }],
    components: [{ id: 5, inWg: 0.2 }],
    equipment: [],
    terminalFlows: [{ id: 6, cfm: 100 }],
    equipmentFlows: [{ id: 7, cfm: 200 }],
    store: { version: 2 },
  });
  const response: DuctsApply.Res.Response = {
    previewOnly: false,
    counts: { planned: 0, written: 5, refused: 2, unchanged: 3 },
    storeRevision: 1,
    systemsAfter: [],
    writes: [
      { kind: "fitting", id: 1, outcome: "written" },
      { kind: "fitting", id: 2, outcome: "refused" },
      { kind: "fitting", id: 3, outcome: "unchanged" },
      { kind: "terminal", id: 4, outcome: "written" },
      { kind: "component", id: 5, outcome: "refused" },
      { kind: "terminal-flow", id: 6, outcome: "unchanged" },
      { kind: "equipment-flow", id: 7, outcome: "written" },
      { kind: "equipment", id: 100, outcome: "written" },
      { kind: "verdict", key: "open-end:4:1", outcome: "written" },
      { kind: "role", id: 8, outcome: "unchanged" },
      { kind: "slot", key: "terminalFlow", outcome: "written" },
    ],
  };
  expect(appliedCellPaths(input, response)).toEqual([
    ["terminalDrops", "4"],
    ["flows", "6"],
    ["equipmentFlows", "7"],
    ["rules", "complete"],
    ["assumptions", "open-end:4:1"],
    ["roles", "8"],
    ["parameters", "terminalFlow"],
  ]);
  expect(appliedCellPaths(input, { ...response, previewOnly: true })).toEqual([]);
});

it("counts the edit cells a write carries, and the ESP among them", () => {
  expect(stagedCells(doc).map(({ segment, key }) => `${segment}:${key}`)).toEqual([
    "flows:4",
    "esp:100",
  ]);
  expect(stagedEsp(doc)).toBe(1);
  expect(stagedEsp(null)).toBe(0);
  expect(pendingCount(null, undefined)).toBe(0);
});

import { scopeApplyRequest } from "./staged.ts";
it("one reviewed fan-flow cell excludes eight unrelated staged and derived writes and their store deltas", () => {
  const store = { version: 2, workRevision: 4, instances: {"99": {coefficient: 0.2, appliedAt: "old"}}, terminals: {}, equipmentFlows: {} };
  const request = {
    slots: {}, fittings: [1,2,3,4].map(id => ({id, ruleKey: `r${id}`})),
    terminals: [{id: 5}], components: [{id: 6}, {id: 7}, {id: 8}], equipment: [], terminalFlows: [],
    equipmentFlows: [{id: 14577391, cfm: 1050}],
    store: { ...store, instances: { ...store.instances, "1": {coefficient: 9, appliedAt: "new"}}, terminals: {"5": {inWg: .026}}, equipmentFlows: {"14577391": {cfm: 1050, appliedAt: "new"}} },
  } as unknown as import("@pe/agent-contracts").DuctsApplyInput;
  const scoped = scopeApplyRequest(request, store as any, [["equipmentFlows", "14577391"]]);
  expect([scoped.fittings, scoped.terminals, scoped.components, scoped.equipment, scoped.terminalFlows].flat()).toEqual([]);
  expect(scoped.equipmentFlows).toEqual([{id: 14577391, cfm: 1050}]);
  expect(scoped.store?.instances).toEqual(store.instances);
  expect(scoped.store?.terminals).toEqual({});
  expect(scoped.store?.equipmentFlows).toEqual(request.store?.equipmentFlows);
  expect(scopeApplyRequest(request, store as any, undefined)).toBe(request);
});
