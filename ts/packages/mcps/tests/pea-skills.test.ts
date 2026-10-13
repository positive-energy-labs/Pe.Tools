import { captureDirectory } from "../../../apps/host/src/packages.ts";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { productPathNames } from "@pe/host-contracts/contracts";
import {
  bundledPeaSkills,
  publishPeaSkills,
  peaStandardSkillsRoot,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  retiredPeaSkillNames,
} from "../src/pea/skills.ts";

const homeVariable = productPathNames.productHomeVariable;

test("resolves pea product home and skills under the product home override", async () => {
  const profile = await withTempProductHomeEnv();
  try {
    const expected = profile.productHome;
    expect(resolvePeaProductHomePath()).toBe(expected);
    expect(resolvePeaSkillPaths()).toEqual([
      path.join(expected, peaStandardSkillsRoot),
      path.join(expected, ".claude", "skills"),
    ]);
  } finally {
    await profile.dispose();
  }
});

async function withTempProductHomeEnv() {
  const previousProductHome = process.env[homeVariable];
  const tempRoot = await mkdtemp(path.join(tmpdir(), "pe-tools-home-"));
  const productHome = path.join(tempRoot, "Pe.Tools");
  process.env[homeVariable] = productHome;

  return {
    productHome,
    dispose: async () => {
      if (previousProductHome == null) delete process.env[homeVariable];
      else process.env[homeVariable] = previousProductHome;

      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

test("materialization retires only the product's former skill directories", async () => {
  const profile = await withTempProductHomeEnv();
  try {
    const skillsRoot = path.join(resolvePeaProductHomePath(), peaStandardSkillsRoot);
    const retired = path.join(skillsRoot, retiredPeaSkillNames[0]!, "SKILL.md");
    const userOwned = path.join(skillsRoot, "my-office-standards", "SKILL.md");
    await mkdir(path.dirname(retired), { recursive: true });
    await mkdir(path.dirname(userOwned), { recursive: true });
    await writeFile(retired, "stale\n", "utf-8");
    await writeFile(userOwned, "mine\n", "utf-8");

    const materialized = await publishPeaSkills({ captureDirectory });

    // Every bundled skill lands under each harness root: Codex's `.agents/skills`, Claude's `.claude/skills`.
    expect(materialized.skills.map((skill) => skill.name)).toContain("my-office-standards");
    for (const root of resolvePeaSkillPaths())
      for (const skill of bundledPeaSkills)
        expect(await readFile(path.join(root, skill.name, "SKILL.md"), "utf8")).toBe(
          `${skill.content.trimEnd()}\n`,
        );
    await expect(access(path.dirname(retired))).rejects.toThrow();
    expect(await readFile(userOwned, "utf-8")).toBe("mine\n");
    expect(retiredPeaSkillNames.some((name) => bundledPeaSkills.some((s) => s.name === name))).toBe(
      false,
    );
  } finally {
    await profile.dispose();
  }
});

const proposeChanges = () => bundledPeaSkills.find((s) => s.name === "propose-changes")!.content;

test("propose-changes teaches segment-array patch paths, never pointer strings", () => {
  const text = proposeChanges();
  expect(text).toContain(`["cells","<key>","proposal"]`);
  expect(text).toContain(`["scope","proposal"]`);
  expect(text).toMatch(/never pointer strings/);
});

test("propose-changes teaches families scope-then-cells from the loaded-families catalog", () => {
  const text = proposeChanges();
  expect(text).toContain("revit.catalog.loaded-families");
  expect(text).toMatch(/scope\.proposal first[^]*next propose call[^]*proposed scope/);
  expect(text).toMatch(/do not wait for the person to stage the scope/i);
  expect(text).toMatch(/description: [^\n]*set <parameter> on every type of <families>/);
});
