import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { createRuntimeRequestContext, resolveRuntimeThreadStateStore } from "@pe/runtime";
import {
  bundledPeaSkills,
  peaProductHomeEnvVar,
  peaProductToolMetadata,
  peaProductTools,
  peaStandardSkillsRoot,
} from "@pe/mcps";
import { createPeaRuntime } from "@pe/runtime/pea";
import { createPeaCliCommand, getPeaCliCommandNames } from "../src/index.ts";

const slowRuntimeTestTimeout = 30_000;

test("pea exposes three capability doors, one Scope door, and the media and docs helpers", () => {
  const names = [
    "pe_find",
    "pe_read",
    "pe_do",
    "scope_set",
    "capture_view",
    "read_image",
    "request_access",
    "revit_api_docs_search",
    "revit_api_docs_fetch",
  ];

  expect(Object.keys(peaProductTools)).toEqual(names);
  expect(Object.keys(peaProductToolMetadata)).toEqual(names);
  expect(peaProductToolMetadata.pe_find.category).toBe("read");
  expect(peaProductToolMetadata.pe_read.category).toBe("read");
  expect(peaProductToolMetadata.pe_do.category).toBe("execute");
});

test("pea composes product commands without dev", () => {
  expect(getPeaCliCommandNames()).toEqual(expect.arrayContaining(["host", "script"]));
  expect(getPeaCliCommandNames()).not.toContain("dev");
  // The standalone `web` subcommand was removed when the host absorbed the web-server path.
  expect(getPeaCliCommandNames()).not.toContain("web");
});

test("pea root command exposes ACP stdio mode without the old protocol stack", () => {
  expect(Object.keys(createPeaCliCommand().args ?? {})).toEqual(
    expect.arrayContaining(["acp", "modelId", "workspaceRoot"]),
  );
  expect(Object.keys(createPeaCliCommand().args ?? {})).not.toContain("protocol");
});

test(
  "pea uses the explicit workspace root and product home bundled skill root",
  async () => {
    const launchCwd = await mkdtemp(path.join(os.tmpdir(), "pea-launch-cwd-"));
    const productHomePath = await mkdtemp(path.join(os.tmpdir(), "pea-product-home-"));
    const state = await isolatePeaState("pea-launch-state-");
    const previousProductHome = process.env[peaProductHomeEnvVar];

    try {
      process.env[peaProductHomeEnvVar] = productHomePath;
      const skill = bundledPeaSkills[0]!;
      const skillPath = path.join(productHomePath, peaStandardSkillsRoot, skill.name, "SKILL.md");
      const launchCwdSkillPath = path.join(
        launchCwd,
        peaStandardSkillsRoot,
        skill.name,
        "SKILL.md",
      );
      const runtime = await createPeaRuntime({ workspaceRoot: launchCwd });

      try {
        expect(runtime.workspace).toEqual({ cwd: launchCwd, root: launchCwd });
        expect(runtime.session?.state.get()).toEqual(
          expect.objectContaining({
            projectPath: launchCwd,
            productHomePath,
          }),
        );
        expect(await readFile(skillPath, "utf-8")).toBe(`${skill.content.trimEnd()}\n`);
        await expect(access(launchCwdSkillPath)).rejects.toThrow();
      } finally {
        await runtime.close?.();
      }

      await writeFile(skillPath, "tampered\n", "utf-8");
      const rematerializedRuntime = await createPeaRuntime({ workspaceRoot: launchCwd });
      await rematerializedRuntime.close?.();
      expect(await readFile(skillPath, "utf-8")).toBe(`${skill.content.trimEnd()}\n`);
      await expect(access(launchCwdSkillPath)).rejects.toThrow();
    } finally {
      if (previousProductHome == null) delete process.env[peaProductHomeEnvVar];
      else process.env[peaProductHomeEnvVar] = previousProductHome;
      state.restore();
      await rm(launchCwd, { recursive: true, force: true });
      await rm(productHomePath, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "pea runtime agent exposes task tools through TaskSignalProvider",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-runtime-"));
    const state = await isolatePeaState("pea-runtime-state-");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;

    try {
      runtime = await createPeaRuntime({ workspaceRoot });
      const agent = getRuntimeAgent(runtime.controller.getMastra(), "pea-agent");
      const tools = await agent.listTools();
      expect(tools).toEqual(
        expect.objectContaining({
          task_write: expect.any(Object),
          task_update: expect.any(Object),
          task_complete: expect.any(Object),
          task_check: expect.any(Object),
        }),
      );
    } finally {
      try {
        await runtime?.close?.();
      } finally {
        state.restore();
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "pea runtime starts with product defaults",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-yolo-"));
    const state = await isolatePeaState("pea-yolo-state-");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;

    try {
      runtime = await createPeaRuntime({ workspaceRoot });
      expect(runtime.session?.model.get()).toBe("anthropic/claude-opus-5");
      expect(runtime.session?.state.get()).toEqual(
        expect.objectContaining({ yolo: false, thinkingLevel: "high" }),
      );
    } finally {
      try {
        await runtime?.close?.();
      } finally {
        state.restore();
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "pea runtime honors configured startup model",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-model-"));
    const state = await isolatePeaState("pea-model-state-");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;

    try {
      runtime = await createPeaRuntime({ workspaceRoot, modelId: "openai/gpt-5.5" });
      expect(runtime.session?.model.get()).toBe("openai/gpt-5.5");
    } finally {
      try {
        await runtime?.close?.();
      } finally {
        state.restore();
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "pea task tools keep memory context when durable execution passes sparse context",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-task-context-"));
    const state = await isolatePeaState("pea-task-state-");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;

    try {
      runtime = await createPeaRuntime({ workspaceRoot });
      const threadId = runtime.session?.thread.getId();
      const resourceId = runtime.session?.identity.getResourceId();
      if (!threadId || !resourceId) throw new Error("Expected Pea runtime session thread.");
      const mastra = runtime.controller.getMastra();
      if (!mastra) throw new Error("Expected Pea runtime controller to expose Mastra.");
      const agent = getRuntimeAgent(mastra, "pea-agent");
      expect(agent.getMastraInstance()).toBe(mastra);
      expect(mastra.getAgentById("pea-agent")).toBe(agent);

      const requestContext = createRuntimeRequestContext({
        protocol: "tui",
        resourceId,
      });
      const tools = await agent.getToolsForExecution({
        threadId,
        resourceId,
        requestContext,
      });

      const result = await tools.task_write.execute(
        {
          tasks: [
            {
              content: "Inspect context",
              status: "in_progress",
              activeForm: "Inspecting context",
            },
          ],
        },
        { toolCallId: "call-1", messages: [], requestContext },
      );
      const check = await tools.task_check.execute(
        {},
        { toolCallId: "call-2", messages: [], requestContext },
      );
      const taskState = await resolveRuntimeThreadStateStore(mastra)?.getState({
        threadId,
        type: "task",
      });

      const resultRecord = readRecord(result);
      const resultContent = typeof resultRecord.content === "string" ? resultRecord.content : "";
      expect(resultRecord).toEqual(expect.objectContaining({ isError: false }));
      expect(resultContent).not.toContain("Task tools require agent memory");
      expect(readRecord(check).summary).toEqual(
        expect.objectContaining({ total: 1, incomplete: 1, hasTasks: true }),
      );
      expect(taskState).toEqual([expect.objectContaining({ content: "Inspect context" })]);
    } finally {
      try {
        await runtime?.close?.();
      } finally {
        state.restore();
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

type RuntimeMastra = {
  getAgentById(id: string): unknown;
};

type RuntimeAgentTool = {
  execute(input: unknown, context: unknown): Promise<unknown>;
};

type RuntimeAgent = {
  getMastraInstance(): unknown;
  getToolsForExecution(request: {
    threadId: string;
    resourceId: string;
    requestContext: ReturnType<typeof createRuntimeRequestContext>;
  }): Promise<Record<string, RuntimeAgentTool>>;
  listTools(): Promise<Record<string, unknown>>;
};

function getRuntimeAgent(mastra: RuntimeMastra | undefined, id: string): RuntimeAgent {
  const agent = mastra?.getAgentById(id);
  if (!isRuntimeAgent(agent)) throw new Error(`Expected runtime agent '${id}'.`);
  return agent;
}

function isRuntimeAgent(value: unknown): value is RuntimeAgent {
  const record = readRecord(value);
  return (
    typeof record.getMastraInstance === "function" &&
    typeof record.getToolsForExecution === "function" &&
    typeof record.listTools === "function"
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isolatePeaState(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const previous = process.env.PE_TOOLS_STATE_DIR;
  process.env.PE_TOOLS_STATE_DIR = root;
  return {
    root,
    restore: () => {
      if (previous === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previous;
    },
  };
}
