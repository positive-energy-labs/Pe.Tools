/**
 * Sided criteria resolve per side (velocity limit, allowance): typing one side never restates the
 * other, so the untyped side keeps its own source through typed > firm. The model store states no criterion (ADR 0053).
 */
import { expect, it } from "vite-plus/test";
import { resolveCriteria } from "./index.ts";
import { stamped, TEST_FIRM } from "@pe/ducts-domain/test-inputs";

it("resolves each side of a sided criterion through its own layers", () => {
  const c = resolveCriteria(
    stamped({ velocityLimitFpm: { supply: 850 }, allowanceInWg: { return: 0.1 } }),
    TEST_FIRM,
  );
  // ba4fd56c: criteria use the shared resolver and retain units, status and version.
  expect(c.velocityLimitFpm).toEqual({
    supply: { value: 850, source: "Work", author: "human", ref: "work:test", units: "fpm", status: "valid", version: null },
    return: { value: TEST_FIRM.criteria.velocityLimitFpm.return, source: "firm", author: null, ref: expect.stringMatching(/^firm:/), units: "fpm", status: "valid", version: "test" },
  });
  expect(c.allowanceInWg).toEqual({
    supply: { value: 0, source: "firm", author: null, ref: expect.stringMatching(/^firm:/), units: "in-wg", status: "valid", version: "test" },
    return: { value: 0.1, source: "Work", author: "human", ref: "work:test", units: "in-wg", status: "valid", version: null },
  });
});
