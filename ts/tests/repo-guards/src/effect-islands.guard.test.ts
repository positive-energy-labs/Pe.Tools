import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import baseline from "./effect-islands.baseline.json" with { type: "json" };
import { census, islandCount } from "./effect-islands-census.ts";
import { increases, tightenedBaseline, trustedBaseline } from "./effect-islands.ts";

const trusted = trustedBaseline();

// Every scenario is a branch of ONE temp repo written by one `git fast-import` (2 spawns for the whole
// file). A test selects its scenario by pointing HEAD at the branch (a file write, no spawn), so it
// pays only trustedBaseline's own 3 spawns. Spawn count is the cost: a loaded machine multiplies it, and
// the old per-test init/config/add/commit/mv (16 to 23 spawns) timed out at the 5 s default.
type Commit = { branch: string; from?: string; files: Record<string, string | null> };
const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
const commitStream = (commits: Commit[]) =>
  commits
    .map(({ branch, from, files }, n) =>
      [
        `commit refs/heads/${branch}\n`,
        `committer Probe <probe@example.invalid> ${1_700_000_000 + n} +0000\n`,
        data(branch),
        from ? `from refs/heads/${from}\n` : "",
        ...Object.entries(files).map(([path, text]) =>
          text === null ? `D "${path}"\n` : `M 100644 inline "${path}"\n${data(text)}`,
        ),
        "\n",
      ].join(""),
    )
    .join("");

const baselinePath = "ts/tests/repo-guards/src/effect-islands.baseline.json";
const oldFile = "apps/probe.ts";
const newFile = "apps/renamed probe.ts";
const marker = "// effect-edge: island, phase 5\n";
const source = `${Array.from({ length: 20 }, (_, i) => `export const n${i} = ${i};`).join("\n")}\n${marker}`;
const json = (src: Record<string, number>, space?: number) =>
  JSON.stringify({ src, tests: {} }, null, space);

// Each scenario is one commit on `base`: `tree` is the source change, `src` the baseline it commits.
const scenarios = {
  rename: { src: { [newFile]: 1 }, tree: { [`ts/${oldFile}`]: null, [`ts/${newFile}`]: source } },
  "rename and raise": {
    src: { [newFile]: 2 },
    tree: { [`ts/${oldFile}`]: null, [`ts/${newFile}`]: `${source}${marker}` },
  },
  new: {
    src: { [oldFile]: 1, [newFile]: 1 },
    tree: { [`ts/${newFile}`]: `${marker}export const brandNew = true;\n` },
  },
  copy: { src: { [oldFile]: 1, [newFile]: 1 }, tree: { [`ts/${newFile}`]: source } },
};

let cwd = "";
const ref = (scenario: string) => scenario.replaceAll(" ", "-");
const checkout = (scenario: string) =>
  writeFileSync(join(cwd, ".git/HEAD"), `ref: refs/heads/${ref(scenario)}\n`);
beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "effect-islands-"));
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, { cwd, input, stdio: ["pipe", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(
    ["fast-import", "--quiet"],
    commitStream([
      {
        branch: "base",
        files: { [baselinePath]: json({ [oldFile]: 1 }), [`ts/${oldFile}`]: source },
      },
      ...Object.entries(scenarios).map(([scenario, { src, tree }]) => ({
        branch: ref(scenario),
        from: "base",
        files: { ...tree, [baselinePath]: json(src) },
      })),
      // History for "never trusts": a raise, then a later commit that only reformats it.
      { branch: "raised", from: "base", files: { [baselinePath]: json({ [oldFile]: 2 }) } },
      { branch: "ratified", from: "raised", files: { [baselinePath]: json({ [oldFile]: 2 }, 2) } },
      // A rename committed after the newest baseline: HEAD differs from the baseline's commit.
      { branch: "renamed-later", from: "base", files: { [`ts/${oldFile}`]: null, [`ts/${newFile}`]: source } },
    ]),
  );
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

it.each(Object.keys(scenarios) as (keyof typeof scenarios)[])(
  "ratchets a committed %s",
  (change) => {
    checkout(change);
    const actual = { src: scenarios[change].src, tests: {} };
    const selected = trustedBaseline(cwd);
    const count = actual.src[newFile]!;
    expect(increases(actual, selected.baseline, "src")).toEqual(
      change === "rename"
        ? []
        : [`${newFile}: ${count} > ${change === "rename and raise" ? 1 : 0}`],
    );
    if (change === "rename")
      expect(tightenedBaseline(actual, actual, selected.baseline, () => false)).toEqual(actual);
    else
      expect(() => tightenedBaseline(actual, actual, selected.baseline, () => false)).toThrow(
        "refused: islands only shrink",
      );
  },
);

it("never trusts a committed baseline raise, even on main", () => {
  checkout("raised");
  const raised = { src: { [oldFile]: 2 }, tests: {} };
  expect(increases(raised, trustedBaseline(cwd).baseline, "src")).toEqual(["apps/probe.ts: 2 > 1"]);
  // A later commit naming the raise as its base cannot ratify it.
  checkout("ratified");
  expect(trustedBaseline(cwd).baseline).toEqual({ src: { [oldFile]: 1 }, tests: {} });
});

it("carries a cap across a rename committed after the newest baseline", () => {
  checkout("renamed-later");
  expect(trustedBaseline(cwd).baseline).toEqual({ src: { [newFile]: 1 }, tests: {} });
});

describe("effect islands shrink only (ADR 0029 rule 2)", () => {
  const actual = census();
  for (const kind of ["src", "tests"] as const) {
    it(`${kind}: no file exceeds its baseline, no new island file`, () => {
      const over = increases(actual, baseline, kind);
      expect(over, `islands grew; stay on the fiber instead:\n${over.join("\n")}`).toEqual([]);
      const untrusted = increases(actual, trusted.baseline, kind);
      expect(untrusted, `islands exceed ${trusted.ref}:\n${untrusted.join("\n")}`).toEqual([]);
    });
    it(`${kind}: the baseline never rises above a committed one`, () => {
      const raised = increases(baseline, trusted.baseline, kind);
      expect(raised, `baseline raised above ${trusted.ref}:\n${raised.join("\n")}`).toEqual([]);
    });
    it(`${kind}: ${Object.values(actual[kind]).reduce((a, b) => a + b, 0)} islands in ${Object.keys(actual[kind]).length} files`, () => {
      console.log(`islands ${kind}: ${Object.values(actual[kind]).reduce((a, b) => a + b, 0)}`);
    });
  }
});

it("tighten refuses to raise a count even when the working baseline was raised", () => {
  expect(() =>
    tightenedBaseline(
      { src: { "apps/probe.ts": 2 }, tests: {} },
      { src: { "apps/probe.ts": 2 }, tests: {} },
      { src: { "apps/probe.ts": 1 }, tests: {} },
      () => false,
    ),
  ).toThrow("apps/probe.ts: 2 -> 2, trusted 1 (refused");
});

it("tighten refuses a nonzero new file", () => {
  expect(() =>
    tightenedBaseline(
      { src: {}, tests: { "apps/probe.test.ts": 1 } },
      { src: {}, tests: {} },
      { src: {}, tests: {} },
      () => true,
    ),
  ).toThrow("apps/probe.test.ts: none -> 1, trusted none (refused");
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
