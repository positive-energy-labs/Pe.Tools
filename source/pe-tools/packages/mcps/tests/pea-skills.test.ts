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
    expect(resolvePeaSkillPaths()).toEqual([path.join(expected, peaStandardSkillsRoot)]);
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

    expect(materialized.map((skill) => skill.name)).toEqual(
      bundledPeaSkills.map((skill) => skill.name),
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
