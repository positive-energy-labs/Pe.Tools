// Lower counts against both the working baseline and the trusted committed-history baseline.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { census, islandCount, isTestFile, tsRoot, type Islands } from "./effect-islands-census.ts";
import { tightenedBaseline, trustedBaseline } from "./effect-islands.ts";

const path = new URL("./effect-islands.baseline.json", import.meta.url);
const trusted = trustedBaseline();
const actual = census();
const baseline = JSON.parse(readFileSync(path, "utf8")) as Islands;
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: tsRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
const existing = new Set(
  git("ls-tree", "--full-tree", "-r", "--name-only", trusted.ref, "--", "ts/apps", "ts/packages")
    .trim()
    .split("\n")
    .map((file) => file.replace(/^ts\//, "")),
);
const isNew = (file: string) => !existing.has(file);
// Census omits zeroes; only genuinely new source files can enter the baseline at zero.
for (const file of git(
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "--",
  "apps",
  "packages",
)
  .trim()
  .split("\n")) {
  if (!/\.[cm]?[jt]sx?$/.test(file) || !isNew(file)) continue;
  const count = islandCount(readFileSync(resolve(tsRoot, file), "utf8"), file);
  actual[isTestFile(file) ? "tests" : "src"][file] = count;
}
const next = tightenedBaseline(actual, baseline, trusted.baseline, isNew);
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
