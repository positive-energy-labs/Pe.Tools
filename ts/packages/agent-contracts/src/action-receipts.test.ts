import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { actionReceiptListDecoder, actionStatusSchema } from "./action-receipts.ts";

test.each([
  ["running", "running", undefined],
  ["unknown", "outcome-unknown", undefined],
  ["incomplete", "outcome-unknown", undefined],
  ["cancelled", "cancelled", undefined],
  ["failed", "refused", "retry"],
  ["succeeded", "succeeded", undefined],
])("%s has one public outcome and preserves its input", (state, outcome, recovery) => {
  const row = actionStatusSchema.parse({
    id: "one",
    key: "write",
    state,
    caller: { kind: "human", via: "local" },
    basis: null,
    target: { kind: "host" },
    input: { value: 13 },
    startedAt: "now",
    error: "Interrupted",
    status: 503,
    ...(state === "failed" ? { notDispatched: true } : {}),
  });
  expect(row.outcome).toMatchObject({ id: "one", state: outcome, input: { value: 13 } });
  expect(row.outcome?.recovery).toBe(recovery);
  if (outcome === "outcome-unknown") expect(row.outcome?.reason).toBe("Interrupted");
});

test("receipt projections remain representable as the public JSON schema", () => {
  expect(z.toJSONSchema(actionStatusSchema)).toBeDefined();
});

test.each([
  [404, "No project home"],
  [503, "Setting store temporarily unavailable"],
])("undispatched tier write %s offers retry", (status, error) => {
  const [row] = actionReceiptListDecoder().parse([{
    id: "transient-tier", key: "settings.tiers.write", state: "failed", notDispatched: true,
    caller: { kind: "human", via: "local" }, basis: null, target: { kind: "host" },
    input: {}, startedAt: "now", status, error,
    steps: [], prepared: { state: "unprepared" }, recovery: [],
  }]);
  expect(row!.outcome).toMatchObject({ state: "refused", recovery: "retry", reason: error });
});

test("not-dispatched Families receipts retain defaults and outcomes", () => {
  const rows = actionReceiptListDecoder().parse([
    {
      id: "stale-families",
      key: "families.apply",
      caller: { kind: "human", via: "local" },
      target: { kind: "host" },
      basis: null,
      input: {},
      startedAt: "now",
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      state: "failed",
      error: "Work changed",
      status: 409,
      notDispatched: true,
    },
  ]);
  expect(rows[0]).toMatchObject({
    effects: [],
    consumes: [],
    outcome: { state: "refused", recovery: "retry" },
  });
});

// Held acts wait for the person; stale observations must be read again before another attempt.
test.each([
  { kind: "held", act: "synchronize", message: "Held for the person" },
  { kind: "invalid" },
  { kind: "stale", consumed: [] },
  { kind: "stale_revision", handle: { key: { route: "fans", binding: "host", target: null }, revision: 1 }, live: 2 },
])("undispatched $kind refusals do not offer retry", (refusal) => {
  const row = actionStatusSchema.parse({
    id: "refusal", key: "write", state: "failed", notDispatched: true,
    caller: { kind: "human", via: "local" }, basis: null, target: { kind: "host" },
    input: {}, startedAt: "now", error: "Read again", status: 409, refusal,
  });
  expect(row.outcome?.recovery).toBeUndefined();
});
