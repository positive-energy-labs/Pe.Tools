/**
 * The rulings the model keeps (pressure-drop ledger, 2026-10-20): the store's `ignore` verdicts
 * and `passive` roles are the base every reader sees, Work holds only the deltas, and a person can
 * take a stored ruling back. Deterministic; the store is a literal.
 */
import { expect, it } from "vite-plus/test";
import { ductsDocumentSchema, stagedDucts } from "@pe/agent-contracts";

import { pendingRulings, storeRulings, withStoredRulings } from "./rulings.ts";
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

it("reads the stored rulings as edit cells, and Work's own over them", () => {
  const work = doc({ roles: { "901": { edit: { value: { role: "passive" } } } } });
  const seen = withStoredRulings(work, store)!;
  const edit = stagedDucts(seen);

  expect(edit.assumptions["open-end:101:1"]).toEqual({ kind: "verdict", verdict: "ignore" });
  expect(edit.roles).toEqual({ "900": { role: "passive" }, "901": { role: "passive" } });
  expect(withStoredRulings(work, store)).toBe(seen);
  expect(pendingRulings(work, store)).toEqual([
    { segment: "roles", key: "901", from: null, to: "passive" },
  ]);
});

it("takes a stored verdict back with a edit delete, and a stored passive is ruled fan", () => {
  const work = doc({
    assumptions: { "open-end:101:1": { edit: { delete: true } } },
    roles: { "900": { edit: { value: { role: "fan" } } } },
  });
  const edit = stagedDucts(withStoredRulings(work, store));

  expect(edit.assumptions).toEqual({});
  expect(edit.roles).toEqual({ "900": { role: "fan" } });
  expect(pendingRulings(work, store)).toEqual([
    { segment: "assumptions", key: "open-end:101:1", from: "ignore", to: null },
    { segment: "roles", key: "900", from: "passive", to: "fan" },
  ]);
  expect(storeRulings(edit, store, "later")).toEqual({
    verdicts: {},
    roles: { "900": { role: "fan", ruledAt: "later" } },
  });
});

it("writes the stored rulings with their own time and new ones with the write's", () => {
  const work = doc({
    assumptions: {
      "proximity:12:0|34:1": { edit: { value: { kind: "verdict", verdict: "ignore" } } },
      "flex-roughness:Flex": { edit: { value: { kind: "flex-roughness", ft: 0.003 } } },
    },
  });
  const edit = stagedDucts(withStoredRulings(work, store));

  expect(storeRulings(edit, store, "later")).toEqual({
    verdicts: {
      "open-end:101:1": { verdict: "ignore", ruledAt: AT },
      "proximity:12:0|34:1": { verdict: "ignore", ruledAt: "later" },
    },
    roles: { "900": { role: "passive", ruledAt: AT } },
  });
});
