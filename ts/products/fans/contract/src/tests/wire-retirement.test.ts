import { expect, test } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { ductsFanCalcSchema } from "../fan-calc-data.ts";
import { fansReadArgs, fansCalcData } from "../fans-read.ts";
import saved from "@pe/ducts-contract/fixtures/synthetic-snapshot.json" with { type: "json" };
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";

test("old calc engines are refused with a notice, never decoded as current calculations", () => {
  const engine = ductsFanCalcSchema.shape.engineVersion;
  expect(engine.parse("calc/1")).toBe("calc/1");
  expect(() => engine.parse("sheet/4")).toThrow("Retired calc engine");
});

test("old calc group snapshots are refused with a notice", () => {
  const decode = fansCalcData.shape.calcSnapshot;
  // A prior fan group is rejected at the product boundary even though native snapshots allow any id.
  // Existing fixture supplies every native field so the retired group is the only failing rule.
  const current = { ...saved, vocabulary: { unitKinds: DUCT_UNIT_KINDS, blockerKinds: FAN_BLOCKER_KINDS } };
  expect(decode.safeParse(current).success).toBe(true);
  const result = decode.safeParse({ ...current, groups: [{ ...current.groups[0]!, id: "sheet" }] });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.message).toContain("Retired calc group");
});

test("old page and request fields are refused, never aliased", () => {
  const address = routeAddress("fans");
  expect(address.tab("/fans?stage=sheet").ok).toBe(false);
  expect(address.tab("/fans?sheetPath=old").ok).toBe(false);
  expect(address.tab(address.link({ stage: "calc", calcPath: "new" })).ok).toBe(true);
  expect(fansReadArgs.safeParse({ target: { session: "s", openId: "d" }, fan: [], sheetPath: "old" }).success).toBe(false);
});
