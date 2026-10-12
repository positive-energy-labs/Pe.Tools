import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  bundledPeaSkills,
  materializeBundledPeaSkills,
  peaProductHomeEnvVar,
  peaStandardSkillsRoot,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  retiredPeaSkillNames,
} from "../src/pea/skills.ts";

test("resolves pea product home under the configured documents root", async () => {
  const profile = await withTempProductHomeEnv();
  try {
    const expected = path.join(profile.documentsRoot, "Pe.Tools");
    expect(resolvePeaProductHomePath()).toBe(expected);
    expect(resolvePeaSkillPaths()).toEqual([
      path.join(expected, peaStandardSkillsRoot),
      path.join(expected, ".claude", "skills"),
    ]);
  } finally {
    await profile.dispose();
  }
});

test("lets explicit pea product home override documents root", async () => {
  const profile = await withTempProductHomeEnv();
  try {
    const productHome = path.join(profile.tempRoot, "custom-product-home");
    process.env[peaProductHomeEnvVar] = productHome;

    expect(resolvePeaProductHomePath()).toBe(productHome);
  } finally {
    await profile.dispose();
  }
});

async function withTempProductHomeEnv() {
  const previousProductHome = process.env[peaProductHomeEnvVar];
  const previousDocumentsRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "pe-tools-home-"));
  const documentsRoot = path.join(tempRoot, "Documents");

  delete process.env[peaProductHomeEnvVar];
  process.env.PE_TOOLS_DOCUMENTS_ROOT = documentsRoot;

  return {
    tempRoot,
    documentsRoot,
    dispose: async () => {
      if (previousProductHome == null) delete process.env[peaProductHomeEnvVar];
      else process.env[peaProductHomeEnvVar] = previousProductHome;

      if (previousDocumentsRoot == null) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
      else process.env.PE_TOOLS_DOCUMENTS_ROOT = previousDocumentsRoot;

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

    const materialized = await materializeBundledPeaSkills();

    // Every bundled skill lands under each harness root: Codex's `.agents/skills`, Claude's `.claude/skills`.
    expect(materialized.map((skill) => skill.name)).toEqual([
      ...bundledPeaSkills.map((skill) => skill.name),
      ...bundledPeaSkills.map((skill) => skill.name),
    ]);
    expect(new Set(materialized.map((skill) => path.dirname(path.dirname(skill.path))))).toEqual(
      new Set(resolvePeaSkillPaths()),
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
