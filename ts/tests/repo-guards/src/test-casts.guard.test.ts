import { describe, expect, it } from "vite-plus/test";
import baseline from "./test-casts.baseline.json" with { type: "json" };
import { census, rises, type TestCasts } from "./test-casts-census.ts";

// A test that casts to a production type duplicates that type's constructor and hides the fields
// the cast skipped (the duct builders in `@pe/ducts-domain/test-snapshot` exposed invalid
// provenances and kinds the casts had carried). The count only falls: replace a cast with the
// production-owned builder, then `vp run ratchets:tighten`.
describe("casts to production types in test files", () => {
  it("do not rise above the baseline", () => {
    const actual = census();
    expect(
      actual.total <= baseline.total ? [] : rises(actual, baseline),
      `${actual.total} casts in ${actual.testFiles} test files; the baseline is ${baseline.total}`,
    ).toEqual([]);
    expect(actual.total).toBeLessThanOrEqual(baseline.total);
  }, 600_000);

  it("names the file whose count rose", () => {
    const at = (byFile: Record<string, number>): TestCasts => ({
      testFiles: 2,
      total: Object.values(byFile).reduce((sum, n) => sum + n, 0),
      byFile,
    });
    expect(
      rises(at({ "a.test.ts": 2, "b.test.ts": 1 }), at({ "a.test.ts": 1, "b.test.ts": 3 })),
    ).toEqual(["a.test.ts: 1 -> 2"]);
    expect(rises(at({ "new.test.ts": 1 }), at({}))).toEqual(["new.test.ts: 0 -> 1"]);
  });
});
