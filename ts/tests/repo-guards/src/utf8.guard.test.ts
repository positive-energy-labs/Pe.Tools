import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vite-plus/test";

it("tracked UTF-8 text has no Windows ANSI round-trip sequences", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  // Exact lead pairs observed in the census, including the lead of nested encoding rounds.
  const patterns = ["\u00c3\u0192", "\u00c3\u00b8", "\u00c2\u00b7", "\u00e2\u20ac", "\u00e2\u2020"];
  const result = spawnSync("git", ["grep", "-I", "-n", "-F", ...patterns.flatMap(pattern => ["-e", pattern]), "--", "."],
    { cwd: root, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status, result.stdout).toBe(1); // git grep exits 1 only when no tracked text matches.
});
