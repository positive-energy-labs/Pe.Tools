import { expect, it } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";

import { pendingCount, stagedCells, stagedEsp } from "./staged.ts";

const doc = ductsRouteState.schema.parse({
  esp: { "100": { staged: { value: { inWg: 0.5 } } } },
  flows: { "4": { staged: { value: { cfm: 100 } } }, "5": {} },
});

it("counts the staged cells a write carries, and the ESP among them", () => {
  expect(stagedCells(doc).map(({ segment, key }) => `${segment}:${key}`)).toEqual([
    "flows:4",
    "esp:100",
  ]);
  expect(stagedEsp(doc)).toBe(1);
  expect(stagedEsp(null)).toBe(0);
  expect(pendingCount(null, undefined)).toBe(0);
});
