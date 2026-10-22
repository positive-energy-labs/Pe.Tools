import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { productPathNames } from "@pe/host-contracts/contracts";
import { peaStandardSkillsRoot } from "@pe/mcps";

const peaProductHomeEnvVar = productPathNames.productHomeVariable;

test("no CLI subcommand and no --help materializes skills into the user's Documents", async () => {
  // w5-revit defect 8: one `pea --help` from a second checkout rewrote the user's skills with
  // that checkout's text. No CLI path materializes skills.
  const productHome = await mkdtemp(path.join(os.tmpdir(), "pea-help-"));
  const originalHome = process.env[peaProductHomeEnvVar];
  const log = console.log;
  process.env[peaProductHomeEnvVar] = productHome;
  console.log = () => {};
  try {
    const { runPeaMain } = await import("../src/cli.ts");
    for (const args of [[], ["--help"], ["script", "--help"], ["host", "--help"], ["script"]])
      await runPeaMain(args).catch(() => {});
    await expect(access(path.join(productHome, peaStandardSkillsRoot))).rejects.toThrow();
  } finally {
    console.log = log;
    if (originalHome === undefined) delete process.env[peaProductHomeEnvVar];
    else process.env[peaProductHomeEnvVar] = originalHome;
    await rm(productHome, { recursive: true, force: true });
  }
});
