import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  peaProductHomeEnvVar,
  peaStandardSkillsRoot,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
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
