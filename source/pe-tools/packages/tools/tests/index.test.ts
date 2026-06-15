import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalFilesystem } from "@mastra/core/workspace";
import { expect, test } from "vite-plus/test";
import { PeCodeCliCommands, PeaCliCommands, ScriptingTools } from "../src/index.ts";
import {
  grantWorkspaceAccess,
  requestAccessRequiresApproval,
} from "../src/shared/request-access.ts";

test("exports command composition and shared scripting surfaces", () => {
  expect(new PeaCliCommands().commands()).toHaveProperty("script");
  expect(new PeCodeCliCommands().commands()).toHaveProperty("live");
  expect(ScriptingTools).toBeTypeOf("function");
});

test("request_access grants through the harness workspace filesystem", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "pe-tools-request-access-root-"));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "pe-tools-request-access-external-"));
  const filesystem = new LocalFilesystem({ basePath: projectRoot, contained: true });
  const state: { sandboxAllowedPaths?: string[]; projectPath?: string; configDir?: string } = {};
  const threadSettingCalls: Array<{ key: string; value: unknown }> = [];
  const threadSettings = {
    setThreadSetting: async (options: { key: string; value: unknown }) => {
      threadSettingCalls.push(options);
    },
  };
  const harnessCtx = {
    getState: () => state,
    setState: async (updates: Partial<typeof state>) => {
      await Promise.resolve();
      Object.assign(state, updates);
    },
    workspace: { filesystem },
  };

  try {
    expect(
      requestAccessRequiresApproval(
        { path: externalRoot, reason: "test" },
        {
          requestContext: {
            get: (key: string) => (key === "harness" ? harnessCtx : undefined),
          },
        },
      ),
    ).toBe(true);

    await grantWorkspaceAccess({
      harnessCtx,
      localFilesystem: filesystem,
      threadSettings,
      absolutePath: externalRoot,
    });

    expect(state.sandboxAllowedPaths).toEqual([externalRoot]);
    expect(threadSettingCalls).toEqual([
      {
        key: "sandboxAllowedPaths",
        value: [externalRoot],
      },
    ]);
    expect([...filesystem.allowedPaths]).toEqual([externalRoot]);
    expect(
      requestAccessRequiresApproval(
        { path: externalRoot, reason: "test" },
        {
          requestContext: {
            get: (key: string) => (key === "harness" ? harnessCtx : undefined),
          },
        },
      ),
    ).toBe(false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});
