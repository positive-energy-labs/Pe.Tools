import { describe, expect, it } from "vite-plus/test";
import baseline from "./health.baseline.json" with { type: "json" };
import { census, isProduction, rises, total, type Health } from "./health-census.ts";

// Each count only falls: remove the cast, suppression or mark, or split the file, then
// `vp run ratchets:tighten`. A total may not rise; code may move between files.
describe("production health counts", () => {
  const actual = census();
  for (const name of Object.keys(actual) as (keyof Health)[])
    it(`${name} do not rise above the baseline`, () => {
      const [now, was] = [total(actual[name]), total(baseline[name])];
      expect(
        now <= was ? [] : rises(actual[name], baseline[name]),
        `${name}: ${now}; the baseline is ${was}`,
      ).toEqual([]);
    });

  it("names the file whose count rose, and reads production files only", () => {
    expect(rises({ "a.ts": 2, "new.cs": 1 }, { "a.ts": 1, "b.ts": 3 })).toEqual([
      "a.ts: 1 -> 2",
      "new.cs: 0 -> 1",
    ]);
    expect(
      [
        "a/b.ts",
        "a/b.test.ts",
        "a/tests/b.ts",
        "X.Tests/B.cs",
        "a/generated/b.ts",
        "b.d.ts",
      ].filter(isProduction),
    ).toEqual(["a/b.ts"]);
  });
});
