import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { createWorkspaceTools, LocalFilesystem } from "@mastra/core/workspace";
import { expect, test } from "vite-plus/test";
import {
  createPeCodeCliCommand,
  createPeCodeProtocolRuntimeFactory,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
  getPeCodeCliCommandNames,
} from "../src/index.ts";
import { defaultPeCodeSandboxAllowedPath } from "../src/runtime.ts";

const slowRuntimeTestTimeout = 30_000;

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
    expect.arrayContaining(["acp", "modelId"]),
  );
});

test(
  "peco runtime agent exposes task tools through TaskSignalProvider",
  async () => {
    const originalCwd = process.cwd();
    const runtime = await (
      await createPeCodeProtocolRuntimeFactory({ cwd: originalCwd })
    ).create({
      protocol: "tui",
      cwd: originalCwd,
      workspaceRoot: originalCwd,
    });

    try {
      const tools = await getRuntimeHarnessAgent(runtime.harness).listTools();
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
  },
  slowRuntimeTestTimeout,
);

type RuntimeAgent = {
  listTools(): Promise<Record<string, unknown>>;
};

type RuntimeHarnessWithCurrentAgent = {
  getCurrentAgent(): unknown;
};

function getRuntimeHarnessAgent(harness: unknown): RuntimeAgent {
  if (!hasCurrentAgent(harness)) throw new Error("Expected runtime harness current agent access.");
  const agent = harness.getCurrentAgent();
  if (!isRuntimeAgent(agent)) throw new Error("Expected runtime harness current agent.");
  return agent;
}

function hasCurrentAgent(value: unknown): value is RuntimeHarnessWithCurrentAgent {
  return isRecord(value) && typeof value.getCurrentAgent === "function";
}

function isRuntimeAgent(value: unknown): value is RuntimeAgent {
  return isRecord(value) && typeof value.listTools === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test(
  "peco protocol runtime does not preselect a startup thread",
  async () => {
    const originalCwd = process.cwd();
    const runtime = await (
      await createPeCodeProtocolRuntimeFactory({ cwd: originalCwd })
    ).create({
      protocol: "tui",
      cwd: originalCwd,
      workspaceRoot: originalCwd,
    });

    try {
      expect(runtime.harness.getCurrentThreadId() ?? undefined).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      await runtime.close?.();
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "peco protocol runtime honors configured startup model",
  async () => {
    const originalCwd = process.cwd();
    const runtime = await (
      await createPeCodeProtocolRuntimeFactory({
        cwd: originalCwd,
        modelId: "openai/gpt-5.5",
      })
    ).create({
      protocol: "acp",
      cwd: originalCwd,
      workspaceRoot: originalCwd,
    });

    try {
      expect(runtime.harness.getState()).toEqual(
        expect.objectContaining({ currentModelId: "openai/gpt-5.5" }),
      );
    } finally {
      process.chdir(originalCwd);
      await runtime.close?.();
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "peco runtime request scope applies additionalDirectories to workspace file tools",
  async () => {
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
      const filesystem = workspace?.filesystem;
      if (!(filesystem instanceof LocalFilesystem)) {
        throw new Error("Expected Peco runtime workspace to use LocalFilesystem.");
      }

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

      expect(filesystem.basePath).toBe(path.resolve(workspaceRoot));
      expect(filesystem.allowedPaths).toEqual(
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
  },
  slowRuntimeTestTimeout,
);

test(
  "peco runtime releases MastraCode-compatible thread locks on close",
  async () => {
    const originalAppData = process.env.APPDATA;
    const originalCwd = process.cwd();
    const appData = await mkdtemp(path.join(os.tmpdir(), "peco-locks-"));
    mkdirSync(appData, { recursive: true });
    process.env.APPDATA = appData;
    let closed = false;

    const runtime = await (
      await createPeCodeProtocolRuntimeFactory({ cwd: originalCwd })
    ).create({
      protocol: "tui",
      cwd: originalCwd,
      workspaceRoot: originalCwd,
    });

    try {
      const session = await runtime.kernel.createThreadSession({ title: "Peco Lock Release" });
      const lockPath = path.join(
        appData,
        "mastracode",
        "locks",
        `${session.threadId.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`,
      );

      expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

      await runtime.close?.();
      closed = true;

      expect(existsSync(lockPath)).toBe(false);
    } finally {
      if (!closed) await runtime.close?.();
      process.chdir(originalCwd);
      if (originalAppData == null) delete process.env.APPDATA;
      else process.env.APPDATA = originalAppData;
      try {
        await rm(appData, { recursive: true, force: true });
      } catch {
        // MastraCode can leave SQLite WAL files busy briefly after shutdown on Windows.
      }
    }
  },
  slowRuntimeTestTimeout,
);
