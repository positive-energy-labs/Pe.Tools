import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { createWorkspaceTools, LocalFilesystem } from "@mastra/core/workspace";
import { expect, test } from "vite-plus/test";
import {
  closePeCodeRuntime,
  createPeCodeCliCommand,
  createPeCodeRuntime,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
  getPeCodeCliCommandNames,
} from "../src/index.ts";
import { defaultPeCodeSandboxAllowedPath } from "../src/runtime.ts";

const slowRuntimeTestTimeout = 30_000;

test("peco composes dev commands", () => {
  expect(getPeCodeCliCommandNames()).toEqual(
    expect.arrayContaining(["live", "script", "talk-to-pea", "talk-to-peco-zellij", "web"]),
  );
});

test("peco default profile includes Pea product and dev tool ids", () => {
  expect(defaultPeCodeRuntimeToolProfile.id).toBe("peco");
  expect(
    [...defaultPeCodeRuntimeToolCatalog.keys()].sort((left, right) => left.localeCompare(right)),
  ).toEqual([
    "capture_view",
    "family_sheet_doc",
    "family_sheet_mark",
    "family_sheet_parse_spec",
    "family_sheet_propose",
    "family_sheet_refresh",
    "family_sheet_status",
    "host_operation_call",
    "host_operation_search",
    "live_loop_context",
    "pe_logs",
    "pe_status",
    "read_image",
    "request_access",
    "revit_api_docs_fetch",
    "revit_api_docs_search",
    "script_bootstrap",
    "script_execute",
    "talk_to_pea",
    "talk_to_peco_zellij",
  ]);
});

test("peco root command exposes ACP stdio mode without the old protocol stack", () => {
  expect(Object.keys(createPeCodeCliCommand().args ?? {})).toEqual(
    expect.arrayContaining(["acp", "modelId", "workspaceRoot"]),
  );
  expect(Object.keys(createPeCodeCliCommand().args ?? {})).not.toContain("protocol");
});

test(
  "peco protocol runtime uses native MastraCode session instead of Pe runtime kernel",
  async () => {
    await withTempAppData("peco-session", async () => {
      const originalCwd = process.cwd();
      const runtime = await createPeCodeRuntime({
        cwd: originalCwd,
        workspaceRoot: originalCwd,
      });

      try {
        expect(runtime.session?.thread.getId()).toEqual(expect.any(String));
        expect("kernel" in runtime).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await closePeCodeRuntime(runtime);
      }
    });
  },
  slowRuntimeTestTimeout,
);

test(
  "peco protocol runtime honors configured startup model",
  async () => {
    await withTempAppData("peco-model", async () => {
      const originalCwd = process.cwd();
      const runtime = await createPeCodeRuntime({
        cwd: originalCwd,
        workspaceRoot: originalCwd,
        modelId: "openai/gpt-5.5",
      });

      try {
        expect(runtime.session?.model.get()).toBe("openai/gpt-5.5");
      } finally {
        process.chdir(originalCwd);
        await closePeCodeRuntime(runtime);
      }
    });
  },
  slowRuntimeTestTimeout,
);

test(
  "peco runtime request scope applies additionalDirectories to workspace file tools",
  async () => {
    await withTempAppData("peco-workspace", async () => {
      const originalCwd = process.cwd();
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "peco-workspace-root-"));
      const externalRoot = await mkdtemp(path.join(os.tmpdir(), "peco-external-root-"));
      await writeFile(path.join(externalRoot, "external.txt"), "external data", "utf-8");

      const runtime = await createPeCodeRuntime({
        cwd: workspaceRoot,
        workspaceRoot,
        additionalDirectories: [externalRoot],
      });

      try {
        if (!runtime.session) throw new Error("Expected Peco runtime session.");
        const workspace = await runtime.controller.resolveWorkspace({ session: runtime.session });
        const tools = await createWorkspaceTools(workspace!);
        const filesystem = workspace?.filesystem;
        if (!(filesystem instanceof LocalFilesystem)) {
          throw new Error("Expected Peco runtime workspace to use LocalFilesystem.");
        }

        const expectedAllowedPaths = [
          path.resolve(defaultPeCodeSandboxAllowedPath),
          path.resolve(externalRoot),
        ];
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

        expect(runtime.session.state.get().sandboxAllowedPaths).toEqual(
          expect.arrayContaining(expectedAllowedPaths),
        );
        expect(filesystem.basePath).toBe(path.resolve(workspaceRoot));
        expect(filesystem.allowedPaths).toEqual(expect.arrayContaining(expectedAllowedPaths));
        expect(listing).toContain("external.txt");
      } finally {
        process.chdir(originalCwd);
        await closePeCodeRuntime(runtime);
        await rm(workspaceRoot, { recursive: true, force: true });
        await rm(externalRoot, { recursive: true, force: true });
      }
    });
  },
  slowRuntimeTestTimeout,
);

test(
  "peco runtime releases MastraCode-compatible thread locks on close",
  async () => {
    await withTempAppData("peco-locks", async (appData) => {
      const originalCwd = process.cwd();
      let closed = false;

      const runtime = await createPeCodeRuntime({
        cwd: originalCwd,
        workspaceRoot: originalCwd,
      });

      try {
        const threadId = runtime.session?.thread.getId();
        if (!threadId) throw new Error("Expected Peco runtime thread.");
        const lockPath = path.join(
          appData,
          "mastracode",
          "locks",
          `${threadId.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`,
        );

        expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

        await closePeCodeRuntime(runtime);
        closed = true;

        expect(existsSync(lockPath)).toBe(false);
      } finally {
        if (!closed) await closePeCodeRuntime(runtime);
        process.chdir(originalCwd);
      }
    });
  },
  slowRuntimeTestTimeout,
);

async function withTempAppData<T>(
  prefix: string,
  run: (appData: string) => Promise<T>,
): Promise<T> {
  const originalAppData = process.env.APPDATA;
  const appData = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  process.env.APPDATA = appData;
  try {
    return await run(appData);
  } finally {
    if (originalAppData == null) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    try {
      await rm(appData, { recursive: true, force: true });
    } catch {
      // MastraCode can leave SQLite WAL files busy briefly after shutdown on Windows.
    }
  }
}
