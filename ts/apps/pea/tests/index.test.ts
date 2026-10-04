import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { peaProductHomeEnvVar, peaProductTools, peaStandardSkillsRoot } from "@pe/mcps";
import { createPeaCliCommand, getPeaCliCommandNames } from "../src/index.ts";

test("pea exposes three capability doors, one Scope door, and the media and docs helpers", () => {
  const names = [
    "pe_find",
    "pe_read",
    "pe_do",
    "target_set",
    "capture_view",
    "read_image",
    "diagram",
    "revit_api_docs_search",
    "revit_api_docs_fetch",
  ];

  expect(Object.keys(peaProductTools)).toEqual(names);
});

test("pea composes product commands without dev", () => {
  expect(getPeaCliCommandNames()).toEqual(expect.arrayContaining(["host", "script"]));
  expect(getPeaCliCommandNames()).not.toContain("dev");
  // The standalone `web` subcommand was removed when the host absorbed the web-server path.
  expect(getPeaCliCommandNames()).not.toContain("web");
});

test("pea root command exposes the harness prompt flags and no ACP agent mode", () => {
  const args = Object.keys(createPeaCliCommand().args ?? {});
  expect(args).toEqual(expect.arrayContaining(["prompt", "harness", "allow", "modelId"]));
  expect(args).not.toContain("acp");
  expect(args).not.toContain("protocol");
});

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
