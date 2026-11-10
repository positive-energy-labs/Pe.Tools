import { expect, test } from "vite-plus/test";
import baseline from "./legacy-shell.baseline.json" with { type: "json" };
import { git, legacyCounts } from "./legacy-shell-census.ts";

const path = "ts/tests/repo-guards/src/legacy-shell.baseline.json";

test("legacy shell imports decrease and their committed allowance never rises", () => {
  // Equality forces every deletion to retire its allowance in the same slice.
  expect(legacyCounts()).toEqual(baseline);
  const versions = git("log", "--format=%H", "HEAD", "--", path).split("\n").filter(Boolean);
  for (const commit of versions) {
    const previous = JSON.parse(git("show", `${commit}:${path}`));
    for (const kind of ["mount", "legacy", "readings"] as const)
      expect(baseline[kind], `${kind} allowance rose above ${commit}`).toBeLessThanOrEqual(previous[kind]);
  }
}, 60_000);
