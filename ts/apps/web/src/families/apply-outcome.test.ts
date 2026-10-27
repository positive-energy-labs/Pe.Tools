import { expect, test } from "vite-plus/test";
import { actionReceiptSchema } from "@pe/agent-contracts";
import { applyOutcome, applyTally } from "./apply-outcome";

const target = { session: "s", openId: "d" };
const native = (familyName: string, success: boolean) => ({
  diagnostics: [],
  receipts: [
    {
      familyId: familyName === "Fan Coil" ? 1 : 2,
      familyName,
      success,
      converged: success,
      residue: [],
      errors: success ? [] : ["family is locked"],
    },
  ],
});
const attempt = {
  id: "apply",
  key: "families.apply",
  target: { kind: "document", ref: target },
  input: {},
  caller: { kind: "human", via: "local" },
  basis: { kind: "human" },
  prepared: { state: "ready", value: {} },
  steps: [],
  recovery: [],
  startedAt: "2026-10-27T10:00:00Z",
};
const row = (result: unknown) =>
  actionReceiptSchema.parse({ ...attempt, state: "succeeded", result });

test("one multi-family command draws every native outcome from the typed result", () => {
  const action = row({
    results: [
      { executionContext: target, native: native("Fan Coil", true) },
      { executionContext: target, native: native("Heat Pump", false) },
    ],
  });
  // Receipt internals are not the presentation contract; this decoy cannot replace two results.
  action.steps = [
    {
      id: "decoy",
      key: "families.apply",
      kind: "native",
      input: {},
      state: "succeeded",
      result: native("Wrong family", true),
    },
  ];
  expect(applyTally(action)).toMatchObject({ families: 2, converged: 1, failed: 1 });
  expect(applyOutcome(action, ["Fan Coil", "Heat Pump"])).toMatchObject({
    code: "partial",
    message: expect.stringContaining("Heat Pump (family is locked)"),
  });
});

test("an uncertain command never presents its one completed native step as a completed batch", () => {
  const action = actionReceiptSchema.parse({
    ...attempt,
    state: "unknown",
    error: "native response lost",
    status: 503,
  });
  expect(applyTally(action).families).toBe(0);
  expect(applyOutcome(action, ["Fan Coil", "Heat Pump"])).toMatchObject({
    code: "failed",
    message: expect.stringContaining("effects unproven"),
  });
});
