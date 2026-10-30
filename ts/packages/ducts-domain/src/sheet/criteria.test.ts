/**
 * Sided criteria resolve per side (velocity limit, allowance): typing one side never restates the
 * other, so the untyped side keeps its own source through typed > stored > firm.
 */
import { expect, it } from "vite-plus/test";
import { resolveCriteria } from "./index.ts";
import { TEST_FIRM } from "./test-inputs.ts";

it("resolves each side of a sided criterion through its own layers", () => {
  const c = resolveCriteria(
    { criteria: { velocityLimitFpm: { supply: 850 }, allowanceInWg: { return: 0.1 } } },
    { criteria: { velocityLimitFpm: { return: 650 } } },
    TEST_FIRM,
  );
  expect(c.velocityLimitFpm).toEqual({
    supply: { value: 850, source: "project" },
    return: { value: 650, source: "stored" },
  });
  expect(c.allowanceInWg).toEqual({
    supply: { value: 0, source: "firm", ref: "test" },
    return: { value: 0.1, source: "project" },
  });
});
