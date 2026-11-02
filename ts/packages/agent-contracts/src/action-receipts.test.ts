import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { actionStatusSchema } from "./action-receipts.ts";

test.each([
  ["waiting", "queued", undefined],
  ["running", "running", undefined],
  ["unknown", "outcome-unknown", "reconcile"],
  ["incomplete", "outcome-unknown", "resume"],
  ["cancelled", "cancelled", undefined],
  ["failed", "failed", "retry"],
  ["succeeded", "succeeded", undefined],
])("%s has one public outcome and preserves its input", (state, outcome, recovery) => {
  const row = actionStatusSchema.parse({ id: "one", key: "write", state, caller: { kind: "human", via: "local" }, basis: null, target: { kind: "host" }, input: { value: 13 }, startedAt: "now", error: "Interrupted", status: 503, ...(state === "failed" ? { notDispatched: true } : {}) });
  expect(row.outcome).toMatchObject({ id: "one", state: outcome, input: { value: 13 } });
  expect(row.outcome?.recovery).toBe(recovery);
  if (outcome === "outcome-unknown") expect(row.outcome?.reason).toBe("Interrupted");
});

test("receipt projections remain representable as the public JSON schema", () => {
  expect(z.toJSONSchema(actionStatusSchema)).toBeDefined();
});
