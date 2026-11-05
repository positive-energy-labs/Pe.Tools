import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import baseline from "./effect-islands.baseline.json" with { type: "json" };
import { census, islandCount } from "./effect-islands-census.ts";
import { increases, tightenedBaseline, trustedBaseline } from "./effect-islands.ts";

const trusted = trustedBaseline();

it.each(["rename", "rename and raise", "new", "copy"])("ratchets a committed %s", (change) => {
  const cwd = mkdtempSync(join(tmpdir(), "effect-islands-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Probe");
    git("config", "user.email", "probe@example.invalid");
    const dir = join(cwd, "ts/tests/repo-guards/src");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(cwd, "ts/apps"));
    const path = join(dir, "effect-islands.baseline.json");
    const oldFile = "apps/probe.ts";
    const newFile = "apps/renamed probe.ts";
    const source = `${Array.from({ length: 20 }, (_, i) => `export const n${i} = ${i};`).join("\n")}\n// effect-edge: island, phase 5\n`;
    writeFileSync(join(cwd, "ts", oldFile), source);
    writeFileSync(path, JSON.stringify({ src: { [oldFile]: 1 }, tests: {} }));
    git("add", "ts");
    git("commit", "-m", "initial baseline");
    git("checkout", "-b", "change");
    if (change.startsWith("rename")) git("mv", `ts/${oldFile}`, `ts/${newFile}`);
    const count = change === "rename and raise" ? 2 : 1;
    writeFileSync(
      join(cwd, "ts", newFile),
      change === "new"
        ? "// effect-edge: island, phase 5\nexport const brandNew = true;\n"
        : `${source}${count === 2 ? "// effect-edge: island, phase 5\n" : ""}`,
    );
    const actual = {
      src: { ...(change.startsWith("rename") ? {} : { [oldFile]: 1 }), [newFile]: count },
      tests: {},
    };
    writeFileSync(path, JSON.stringify(actual));
    git("add", "ts");
    git("commit", "-m", change);
    expect(git("status", "--porcelain")).toBe("");
    const selected = trustedBaseline(cwd);
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
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("never trusts a committed baseline raise, even on main", () => {
  const cwd = mkdtempSync(join(tmpdir(), "effect-islands-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Probe");
    git("config", "user.email", "probe@example.invalid");
    const dir = join(cwd, "ts/tests/repo-guards/src");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "effect-islands.baseline.json");
    const original = { src: { "apps/probe.ts": 1 }, tests: {} };
    writeFileSync(path, JSON.stringify(original));
    git("add", ".");
    git("commit", "-m", "initial baseline");
    const raised = { src: { "apps/probe.ts": 2 }, tests: {} };
    writeFileSync(path, JSON.stringify(raised));
    git("commit", "-am", "raise baseline on main");
    expect(increases(raised, trustedBaseline(cwd).baseline, "src")).toEqual([
      "apps/probe.ts: 2 > 1",
    ]);
    // A later commit naming the raise as its base cannot ratify it.
    writeFileSync(path, JSON.stringify(raised, null, 2));
    git("commit", "-am", "ratify");
    expect(trustedBaseline(cwd).baseline).toEqual(original);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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
