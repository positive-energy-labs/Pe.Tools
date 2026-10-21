/**
 * The rulings the model keeps (pressure-drop ledger, 2026-10-20): the store's `ignore` verdicts
 * and `passive` roles are the base every reader sees, Work holds only the deltas, and a person can
 * take a stored ruling back. Deterministic; the store is a literal.
 */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema, stagedDucts } from "@pe/agent-contracts";

import { pendingRulings, rulingRung, storeRulings, withStoredRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

const AT = "2026-10-20T12:00:00.000Z";
const store = {
  version: 2,
  rules: {},
  instances: {},
  terminals: {},
  terminalFlows: {},
  equipmentFlows: {},
  verdicts: { "open-end:101:1": { verdict: "ignore", ruledAt: AT } },
  roles: { "900": { role: "passive", ruledAt: AT } },
  workRevision: 3,
} satisfies NonNullable<DuctSnapshot["store"]>;
const doc = (raw: unknown) => ductsDocumentSchema.parse(raw);

it("reads the stored rulings as staged cells, and Work's own over them", () => {
  const work = doc({ roles: { "901": { staged: { value: { role: "passive" } } } } });
  const seen = withStoredRulings(work, store)!;
  const staged = stagedDucts(seen);

  expect(staged.assumptions["open-end:101:1"]).toEqual({ kind: "verdict", verdict: "ignore" });
  expect(staged.roles).toEqual({ "900": { role: "passive" }, "901": { role: "passive" } });
  expect(withStoredRulings(work, store)).toBe(seen);
  expect(pendingRulings(work, store)).toEqual([
    { segment: "roles", key: "901", from: null, to: "passive" },
  ]);
});

it("reads no store as the Work itself", () => {
  const work = doc({});
  expect(withStoredRulings(work, null)).toBe(work);
  expect(withStoredRulings(null, undefined)).toBeNull();
});

it("takes a stored verdict back with a staged delete, and a stored passive is ruled fan", () => {
  const work = doc({
    assumptions: { "open-end:101:1": { staged: { delete: true } } },
    roles: { "900": { staged: { value: { role: "fan" } } } },
  });
  const staged = stagedDucts(withStoredRulings(work, store));

  expect(staged.assumptions).toEqual({});
  expect(staged.roles).toEqual({ "900": { role: "fan" } });
  expect(pendingRulings(work, store)).toEqual([
    { segment: "assumptions", key: "open-end:101:1", from: "ignore", to: null },
    { segment: "roles", key: "900", from: "passive", to: "fan" },
  ]);
  expect(storeRulings(staged, store, "later")).toEqual({
    verdicts: {},
    roles: { "900": { role: "fan", ruledAt: "later" } },
  });
});

it("writes the stored rulings with their own time and new ones with the write's", () => {
  const work = doc({
    assumptions: {
      "proximity:12:0|34:1": { staged: { value: { kind: "verdict", verdict: "ignore" } } },
      "flex-roughness:Flex": { staged: { value: { kind: "flex-roughness", ft: 0.003 } } },
    },
  });
  const staged = stagedDucts(withStoredRulings(work, store));

  expect(storeRulings(staged, store, "later")).toEqual({
    verdicts: {
      "open-end:101:1": { verdict: "ignore", ruledAt: AT },
      "proximity:12:0|34:1": { verdict: "ignore", ruledAt: "later" },
    },
    roles: { "900": { role: "passive", ruledAt: AT } },
  });
});

it("stages a choice against the store: the stored value clears, a take-back deletes", () => {
  expect(rulingRung(store, "assumptions", "open-end:101:1", "ignore")).toBe("unstage");
  expect(rulingRung(store, "assumptions", "open-end:101:1", null)).toEqual({ delete: true });
  expect(rulingRung(store, "assumptions", "open-end:202:1", "ignore")).toEqual({
    value: { kind: "verdict", verdict: "ignore" },
  });
  expect(rulingRung(store, "assumptions", "open-end:202:1", null)).toBe("unstage");
  expect(rulingRung(store, "roles", "900", "passive")).toBe("unstage");
  expect(rulingRung(store, "roles", "900", "fan")).toEqual({ value: { role: "fan" } });
  expect(rulingRung(store, "roles", "901", "fan")).toEqual({ value: { role: "fan" } });
  expect(rulingRung(store, "roles", "901", null)).toBe("unstage");
  expect(rulingRung(null, "roles", "901", "passive")).toEqual({ value: { role: "passive" } });
});
