import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import baseline from "./effect-islands.baseline.json" with { type: "json" };
import { census, islandCount, tsRoot, type Islands } from "./effect-islands-census.ts";

// ADR 0029 rule 2: phase 5 deletes the islands, so the set only shrinks. A file may not gain a
// marker, a new file may not gain its first, and the baseline may not be raised by editing it.
const baselinePath = "ts/tests/repo-guards/src/effect-islands.baseline.json";
const committed = (() => {
  try {
    return JSON.parse(
      execFileSync("git", ["show", `HEAD:${baselinePath}`], {
        cwd: tsRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as Islands;
  } catch {
    return undefined; // not committed yet: the first commit defines the universe
  }
})();

describe("effect islands shrink only (ADR 0029 rule 2)", () => {
  const actual = census();
  for (const kind of ["src", "tests"] as const) {
    it(`${kind}: no file exceeds its baseline, no new island file`, () => {
      const over = Object.entries(actual[kind])
        .filter(
          ([file, count]) =>
            count > (baseline[kind][file as keyof (typeof baseline)[typeof kind]] ?? 0),
        )
        .map(
          ([file, count]) =>
            `${file}: ${count} > ${(baseline[kind] as Record<string, number>)[file] ?? 0}`,
        );
      expect(over, `islands grew; stay on the fiber instead:\n${over.join("\n")}`).toEqual([]);
    });
    it(`${kind}: the baseline never rises above the committed one`, () => {
      if (!committed) return;
      const raised = Object.entries(baseline[kind] as Record<string, number>)
        .filter(([file, count]) => count > (committed[kind][file] ?? 0))
        .map(([file, count]) => `${file}: ${count} > ${committed[kind][file] ?? 0}`);
      expect(raised, `baseline raised:\n${raised.join("\n")}`).toEqual([]);
    });
    it(`${kind}: ${Object.values(actual[kind]).reduce((a, b) => a + b, 0)} islands in ${Object.keys(actual[kind]).length} files`, () => {
      console.log(
        `islands ${kind}: ${JSON.stringify(Object.values(actual[kind]).reduce((a, b) => a + b, 0))}`,
      );
    });
  }
});

it("counts only real comment tokens", () => {
  const marker = "// effect-edge: island, phase 5";
  expect(islandCount(`${marker}\nEffect.runPromise(p);`)).toBe(1);
  expect(islandCount(`Effect.runPromise(p); ${marker}`)).toBe(1);
  expect(islandCount(`const s = "${marker}";`)).toBe(0);
  expect(islandCount("const s = `\n// effect-edge: island, phase 5\n`;")).toBe(0);
  expect(islandCount("/* effect-edge: island, phase 5 */")).toBe(0);
  expect(islandCount("// effect-edge: process-main")).toBe(0);
});
