import { expect, test } from "vite-plus/test";
import { appliedCellPaths } from "@pe/ducts-domain/staged";
import { lossPlanRefusal } from "../src/ducts-actions.ts";

// The native owner (DuctApplier.SharedTypes) refuses a type-owned write whose type has units the request does not
// name, and then refuses every other planned row, store included. These rows are that response's shape.
const scope =
  "type 'Fantech: MUAS10' holds this parameter for 2 units; the request names 1 and would also move MUAS-2 (14577392)";
const unscoped = [
  { id: 14577391, kind: "equipment", outcome: "refused", reason: scope, before: "type 0 in-wg" },
  { id: 900, kind: "fitting", outcome: "refused", reason: "not written: a shared type parameter in this apply would move units it does not name (see the refused equipment)" },
  { id: null, kind: "store", outcome: "refused", reason: "not written: a shared type parameter in this apply would move units it does not name (see the refused equipment)" },
];

test("a loss plan the native owner refuses for type scope arms nothing and names the type and its peer", () => {
  const refusal = lossPlanRefusal(unscoped);
  expect(refusal).toContain("Fantech: MUAS10");
  expect(refusal).toContain("MUAS-2 (14577392)");
});

test("a refused apply retires no staged cell: the fan static stays staged", () => {
  const input = { terminals: [], components: [], equipment: [{ id: 14577391, externalStaticInWg: 2.6581 }], terminalFlows: [], equipmentFlows: [], fittings: [] };
  expect(appliedCellPaths(input as never, { previewOnly: false, writes: unscoped } as never)).toEqual([]);
});

test("ordinary plans with a planned row still arm; an all-unchanged plan is not a refusal", () => {
  expect(lossPlanRefusal([{ id: 1, kind: "equipment", outcome: "planned", after: "instance 'ESP' 1 in-wg" }, ...unscoped.slice(1)])).toBeNull();
  expect(lossPlanRefusal([{ id: 1, kind: "equipment", outcome: "unchanged" }])).toBeNull();
});
