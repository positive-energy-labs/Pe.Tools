import { expect, test } from "vite-plus/test";
import { healedCellPaths } from "../src/ducts-actions.ts";
import type { DuctsHeal } from "@pe/host-contracts/generated";

const input = { groups: [{ group: "g1", items: [{ key: "cap:1:0" }] }] };
const receipt = (outcome: string) =>
  ({
    previewOnly: false,
    groups: [{ group: "g1", outcome, items: [{ key: "cap:1:0", outcome }] }],
  }) as DuctsHeal.Res.Response;
test("heal retires only completely receipt-confirmed intent", () => {
  expect(healedCellPaths(input, receipt("healed"))).toEqual([["writeIntent"]]);
  for (const outcome of ["refused", "failed", "partial"])
    expect(healedCellPaths(input, receipt(outcome))).toEqual([]);
  expect(healedCellPaths(input, { ...receipt("healed"), groups: [] })).toEqual([]);
});
