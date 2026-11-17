import { expect, test } from "vite-plus/test";
import { bindWork } from "@pe/agent-contracts";
import { familyCellKey } from "../../../packages/agent-contracts/src/families.ts";
import { confirmedRetirement } from "../src/family-actions.ts";

// SMELL-FF-RETIRE-01: consumed Work retires only where a successful native receipt confirms it.
const target = { session: "s", openId: "o" };
const cell = (familyName: string) => familyCellKey({ familyName, typeName: "T", parameter: "P" });
const receipt = (familyName: string, success: boolean, converged = success) => ({
  familyName,
  success,
  converged,
});
const family = {
  key: bindWork("family", null, undefined, target),
  route: "family" as const,
  cells: ["a", "b"],
};
const families = {
  key: bindWork("families", null, undefined, target),
  route: "families" as const,
  cells: [cell("Fan"), cell("Pump")],
  patch: true as const,
};

test("a cancelled family apply with no successful receipt retires nothing", () => {
  expect(confirmedRetirement(family, undefined, [])).toEqual([]);
  expect(confirmedRetirement(family, undefined, [receipt("Fan", false)])).toEqual([]);
});

test("a successful family apply retires its consumed cells", () => {
  expect(confirmedRetirement(family, undefined, [receipt("Fan", true)])).toEqual([
    ["cells", "a"],
    ["cells", "b"],
  ]);
});

test("a project apply retires only cells of families whose receipt succeeded", () => {
  expect(
    confirmedRetirement(families, ["Fan", "Pump"], [receipt("Fan", true), receipt("Pump", false)]),
  ).toEqual([["cells", cell("Fan")]]);
});

test("a patch retires only when every targeted family converged, and never on zero successes", () => {
  const both = [receipt("Fan", true), receipt("Pump", true)];
  expect(confirmedRetirement(families, ["Fan", "Pump"], both)).toContainEqual(["patch"]);
  expect(
    confirmedRetirement(families, ["Fan", "Pump"], [receipt("Fan", true), receipt("Pump", true, false)]),
  ).not.toContainEqual(["patch"]);
  expect(confirmedRetirement(families, [], [receipt("Fan", false)])).toEqual([]);
});
