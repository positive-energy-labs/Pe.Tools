import { expect, it } from "vite-plus/test";
import { ductsRouteState, ductsApplyInputSchema } from "@pe/agent-contracts";
import type { DuctsApply } from "@pe/host-contracts/generated";

import { appliedCellPaths, pendingCount, stagedCells, stagedEsp } from "./staged.ts";

const doc = ductsRouteState.schema.parse({
  esp: { "100": { edit: { value: { inWg: 0.5 } } } },
  flows: { "4": { edit: { value: { cfm: 100 } } }, "5": {} },
});

it("retires only transmitted successful writes, retaining held ESP and partially refused rules", () => {
  const input = ductsApplyInputSchema.parse({
    fittings: [
      { id: 1, method: "pe-server", coefficient: 1, ruleKey: "partial" },
      { id: 2, method: "pe-server", coefficient: 1, ruleKey: "partial" },
      { id: 3, method: "pe-server", coefficient: 1, ruleKey: "complete" },
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
