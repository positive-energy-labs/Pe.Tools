import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { createWorkspaceTools } from "@mastra/core/workspace";
import { expect, test } from "vite-plus/test";
import { createRuntimeAcpCliOptions, createRuntimeAgUiCliOptions } from "@pe/runtime";
import {
  createPeCodeCliCommand,
  createPeCodeProtocolRuntimeFactory,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
  getPeCodeCliCommandNames,
} from "../src/index.ts";
import { ensureDevAgentProjectFiles } from "../src/project-files.ts";
import { defaultPeCodeSandboxAllowedPath } from "../src/runtime.ts";

test("peco composes dev commands", () => {
  expect(getPeCodeCliCommandNames()).toEqual(
    expect.arrayContaining(["live", "script", "talk-to-pea", "talk-to-peco-zellij"]),
  );
});

test("peco default profile includes Pea product and dev tool ids", () => {
  expect(defaultPeCodeRuntimeToolProfile.id).toBe("peco");
  expect(
    [...defaultPeCodeRuntimeToolCatalog.keys()].sort((left, right) => left.localeCompare(right)),
  ).toEqual([
    "host_operation_call",
    "host_operation_search",
    "live_loop_context",
    "live_rrd_restart",
    "live_rrd_sync",
    "pe_logs",
    "pe_status",
    "request_access",
    "script_bootstrap",
    "script_execute",
    "script_pod_export",
    "script_pod_import",
    "talk_to_pea",
    "talk_to_peco_zellij",
    "test",
  ]);
});

test("peco root command exposes runtime protocol flags", () => {
  expect(Object.keys(createPeCodeCliCommand().args ?? {})).toEqual(
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

test("peco runtime protocol CLI values map to nested transport options", () => {
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

test("peco project bootstrap reports manual skills from the standard .agents location", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "peco-skills-"));
  const skillRoot = path.join(workspaceRoot, ".agents", "skills", "manual-skill");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    "---\nname: manual-skill\n---\n\n# Manual Skill\n",
    "utf-8",
  );

  try {
    const summary = await ensureDevAgentProjectFiles(workspaceRoot);

    expect(summary.skillsRoot).toBe(path.join(workspaceRoot, ".agents", "skills"));
    expect(summary.skills).toEqual([
      {
        name: "manual-skill",
        path: path.join(skillRoot, "SKILL.md"),
        status: "unchanged",
      },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("peco runtime agent exposes task tools through TaskSignalProvider", async () => {
  const originalCwd = process.cwd();
  const runtime = await (
    await createPeCodeProtocolRuntimeFactory({ cwd: originalCwd })
  ).create({
    protocol: "tui",
    cwd: originalCwd,
    workspaceRoot: originalCwd,
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
    process.chdir(originalCwd);
    await runtime.close?.();
  }
});

test("peco runtime request scope applies additionalDirectories to workspace file tools", async () => {
  const originalCwd = process.cwd();
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "peco-workspace-root-"));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "peco-external-root-"));
  await writeFile(path.join(externalRoot, "external.txt"), "external data", "utf-8");

  const runtime = await (
    await createPeCodeProtocolRuntimeFactory({ cwd: originalCwd })
  ).create({
    protocol: "acp",
    cwd: workspaceRoot,
    workspaceRoot,
    additionalDirectories: [externalRoot],
  });

  try {
    const workspace = await runtime.harness.resolveWorkspace();
    const tools = await createWorkspaceTools(workspace!);

    const listing = await tools.find_files.execute(
      {
        path: externalRoot,
        maxDepth: 1,
        respectGitignore: false,
      },
      {
        workspace,
        requestContext: new RequestContext(),
      },
    );

    expect((workspace?.filesystem as any)?.basePath).toBe(path.resolve(workspaceRoot));
    expect((workspace?.filesystem as any)?.allowedPaths).toEqual(
      expect.arrayContaining([
        path.resolve(defaultPeCodeSandboxAllowedPath),
        path.resolve(externalRoot),
      ]),
    );
    expect(listing).toContain("external.txt");
  } finally {
    process.chdir(originalCwd);
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});
