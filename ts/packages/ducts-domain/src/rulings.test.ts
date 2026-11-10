// U4 wires the real fans Work for callers without one.
import { neutralFansWork } from "@pe/agent-contracts";
/**
 * The rulings the model keeps (pressure-drop ledger, 2026-10-20): the store's `ignore` verdicts
 * and `passive` roles are the base every reader sees, Work holds only the deltas, and a person can
 * take a stored ruling back. Deterministic; the store is a literal.
 */
import { designOf } from "./test-design.ts";
import { expect, it } from "vite-plus/test";
import { stagedDucts } from "@pe/agent-contracts";

import { pendingRulings, storeRulings, withStoredRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

const snapshot = { nodes: [900, 901].map(id => ({ id, uniqueId: `6d52156a-3876-4d76-b641-341454252f26-${id.toString(16).padStart(8, "0")}`, connectors: [] })), segments: [] } as any;
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
const doc = designOf;

it("reads the stored rulings as edit cells, and Work's own over them", () => {
  const work = doc({ roles: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000385": { edit: { value: { role: "passive" } } } } });
  const seen = withStoredRulings(work, store, snapshot)!;
  const edit = stagedDucts(seen, (seen) ?? neutralFansWork);

  expect(edit.assumptions["open-end:101:1"]).toEqual({ kind: "verdict", verdict: "ignore" });
  expect(edit.roles).toEqual({ "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000384": { role: "passive" }, "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000385": { role: "passive" } });
  expect(withStoredRulings(work, store, snapshot)).toBe(seen);
  expect(pendingRulings(work, store, snapshot)).toEqual([
    { segment: "roles", key: "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000385", from: null, to: "passive" },
  ]);
});

it("takes a stored verdict back with a edit delete, and a stored passive is ruled fan", () => {
  const work = doc({
    assumptions: { "open-end:101:1": { edit: { delete: true } } },
    roles: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000384": { edit: { value: { role: "fan" } } } },
  });
  const seen = withStoredRulings(work, store, snapshot);
  const edit = stagedDucts(seen, seen ?? neutralFansWork);

  expect(edit.assumptions).toEqual({});
  expect(edit.roles).toEqual({ "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000384": { role: "fan" } });
  expect(pendingRulings(work, store, snapshot)).toEqual([
    { segment: "assumptions", key: "open-end:101:1", from: "ignore", to: null },
    { segment: "roles", key: "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000384", from: "passive", to: "fan" },
  ]);
  expect(storeRulings(edit, store, "later", snapshot)).toEqual({
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
  const seen = withStoredRulings(work, store, snapshot);
  const edit = stagedDucts(seen, seen ?? neutralFansWork);

  expect(storeRulings(edit, store, "later", snapshot)).toEqual({
    verdicts: {
      "open-end:101:1": { verdict: "ignore", ruledAt: AT },
      "proximity:12:0|34:1": { verdict: "ignore", ruledAt: "later" },
    },
    roles: { "900": { role: "passive", ruledAt: AT } },
  });
});
