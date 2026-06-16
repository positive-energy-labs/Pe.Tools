import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { createRuntimeAcpCliOptions, createRuntimeAgUiCliOptions } from "@pe/runtime";
import { bundledPeaSkills, peaStandardSkillsRoot } from "@pe/tools";
import {
  createPeaCliCommand,
  createPeaProtocolRuntimeFactory,
  defaultPeaRuntimeToolCatalog,
  defaultPeaRuntimeToolProfile,
  getPeaCliCommandNames,
} from "../src/index.ts";
import { createPeaRuntimeAuthProfile } from "../src/runtime.ts";

test("pea composes product commands without dev", () => {
  expect(getPeaCliCommandNames()).toEqual(expect.arrayContaining(["beta-tui", "host", "script"]));
  expect(getPeaCliCommandNames()).not.toContain("dev");
});

test("pea defaults to Pea Cloud Gateway auth", () => {
  const auth = createPeaRuntimeAuthProfile();

  expect(auth.descriptor.source).toBe("gateway");
  expect(auth.descriptor.methods.map((method) => method.id)).toEqual(["pea-cloud-gateway"]);
});

test("pea exports the product tool profile used by the default runtime", () => {
  expect(defaultPeaRuntimeToolProfile.id).toBe("pea-product");
  expect(
    [...defaultPeaRuntimeToolCatalog.keys()].sort((left, right) => left.localeCompare(right)),
  ).toEqual([
    "host_operation_call",
    "host_operation_search",
    "pe_logs",
    "pe_status",
    "request_access",
    "script_bootstrap",
    "script_execute",
    "script_pod_export",
    "script_pod_import",
  ]);
});

test("pea root command exposes runtime protocol flags", () => {
  expect(Object.keys(createPeaCliCommand().args ?? {})).toEqual(
    expect.arrayContaining([
      "acp",
      "acpTransport",
      "acpPort",
      "acpToken",
      "agUi",
      "agUiPort",
      "agUiToken",
    ]),
  );
});

test("pea runtime protocol CLI values map to nested transport options", () => {
  expect(
    createRuntimeAcpCliOptions(
      { acp: true, acpTransport: "http", acpPort: "43111", acpToken: "t" },
      {},
    ),
  ).toEqual({ protocolTransport: "http", transport: { port: 43111, token: "t" } });
  expect(
    createRuntimeAgUiCliOptions({ agUi: true, agUiPort: "43112", agUiToken: "t" }, {}),
  ).toEqual({ transport: { port: 43112, token: "t" } });
});

test("pea materializes bundled skills into the standard .agents location at runtime startup", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-skills-"));
  const skill = bundledPeaSkills[0]!;
  const skillPath = path.join(workspaceRoot, peaStandardSkillsRoot, skill.name, "SKILL.md");

  try {
    await createPeaProtocolRuntimeFactory({ workspaceRoot });
    expect(await readFile(skillPath, "utf-8")).toBe(`${skill.content.trimEnd()}\n`);

    await writeFile(skillPath, "tampered\n", "utf-8");
    await createPeaProtocolRuntimeFactory({ workspaceRoot });
    expect(await readFile(skillPath, "utf-8")).toBe(`${skill.content.trimEnd()}\n`);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("pea runtime agent exposes task tools through TaskSignalProvider", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-runtime-"));
  const runtime = await (
    await createPeaProtocolRuntimeFactory({ workspaceRoot })
  ).create({
    protocol: "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  });

  try {
    const tools = await (runtime.harness as any).getCurrentAgent().listTools();
    expect(tools).toEqual(
      expect.objectContaining({
        task_write: expect.any(Object),
        task_update: expect.any(Object),
        task_complete: expect.any(Object),
        task_check: expect.any(Object),
      }),
    );
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
