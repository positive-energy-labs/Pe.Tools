import { expect, test } from "vite-plus/test";
import { ductsApplyInputSchema, neutralFansWork } from "@pe/agent-contracts";
import { applyRequest, price } from "./pricing.ts";
import { snapshotOf } from "./test-snapshot.ts";
import type { Row } from "./losses.ts";

const request = () => {
  const snapshot = snapshotOf();
  const priced = price(snapshot, {}, null, neutralFansWork);
  const row = (c: number, pv: number): Row => ({
    id: 4, kind: "fitting", rule: "test-rule", table: "SD5-9", c, pv, dp: c * pv, desc: "test fitting",
  });
  return applyRequest(snapshot, {
    ...priced,
    edit: { ...priced.edit, rules: { "test-rule": { table: "SD5-9" } } },
    next: { ...priced.next, paths: {
      8: { groupId: "test", total: 0, tel: 0, path: [4, 8], inferred: [], provisional: null,
        rows: [row(-2, 0), row(0, 0.02)] },
    } },
  }, "2026-11-16T00:00:00Z", []);
};

test("admits host results and refuses a Pe-server request with no priced basis", () => {
  const input = request();
  expect(ductsApplyInputSchema.safeParse(input).success).toBe(true);
  const missing = { ...input, fittings: input.fittings.map(({ results: _results, ...fitting }) => fitting) };
  const refused = ductsApplyInputSchema.safeParse(missing);
  expect(refused.success).toBe(false);
  if (!refused.success) expect(refused.error.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: ["fittings", 0, "results"], message: "Host-priced leg results are required" }),
  ]));
});

test("retains signed and zero coefficients on every priced basis", () => {
  expect(request().fittings[0]!.results).toEqual([
    { velocityPressureInWg: 0, coefficient: -2 },
    { velocityPressureInWg: 0.02, coefficient: 0 },
  ]);
});
