import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import { createRuntimeRequestContext, resolveRuntimeThreadStateStore } from "@pe/runtime";
import { bundledPeaSkills, peaProductHomeEnvVar, peaStandardSkillsRoot } from "@pe/tools";
import {
  createPeaCliCommand,
  createPeaRuntime,
  defaultPeaRuntimeToolCatalog,
  defaultPeaRuntimeToolProfile,
  getPeaCliCommandNames,
  PeaContextSignalProvider,
  PeaContextStateProcessor,
  type PeaContextStateSignalArgs,
} from "../src/index.ts";
import { createPeaRuntimeAuthProfile } from "../src/runtime.ts";

const slowRuntimeTestTimeout = 30_000;

test("pea composes product commands without dev", () => {
  expect(getPeaCliCommandNames()).toEqual(expect.arrayContaining(["host", "script", "web"]));
  expect(getPeaCliCommandNames()).not.toContain("dev");
});

test("pea defaults to Pea Cloud Gateway auth", () => {
  const auth = createPeaRuntimeAuthProfile();

  expect(auth.descriptor.source).toBe("gateway");
  expect(auth.descriptor.methods.map((method) => method.id)).toEqual(["pea-cloud-gateway"]);
  expect(auth.descriptor.metadata).toEqual({ gateway: "mastra", gatewayAuthority: "pea-cloud" });
});

test("pea can opt out of cloud auth for local provider-key use", () => {
  const auth = createPeaRuntimeAuthProfile({ noCloudAuth: true });

  expect(auth.descriptor.source).toBe("api-key");
  expect(auth.descriptor.methods.map((method) => method.id)).toEqual(["openai-api-key"]);
  expect(auth.descriptor.metadata).toBeUndefined();
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
    const previousProductHome = process.env[peaProductHomeEnvVar];
    process.env[peaProductHomeEnvVar] = productHomePath;

    const skill = bundledPeaSkills[0]!;
    const skillPath = path.join(productHomePath, peaStandardSkillsRoot, skill.name, "SKILL.md");
    const launchCwdSkillPath = path.join(launchCwd, peaStandardSkillsRoot, skill.name, "SKILL.md");

    try {
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
    const runtime = await createPeaRuntime({ workspaceRoot });

    try {
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
      await runtime.close?.();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test("pea context signal provider exposes a snapshot state processor", () => {
  const provider = new PeaContextSignalProvider();

  expect(provider.getInputProcessors()).toEqual([
    expect.objectContaining({ id: "pea-context-state", stateId: "pea-workbench-context" }),
  ]);
});

test("pea context state processor emits first runtime context snapshot", () => {
  const processor = new PeaContextStateProcessor();
  const requestContext = createRuntimeRequestContext({
    protocol: "tui",
    resourceId: "pea:test",
    entries: [
      { description: " active document ", value: "  Project A & B.rvt  " },
      { description: "blank", value: "  " },
    ],
  });

  const signal = processor.computeStateSignal({
    requestContext,
    contextWindow: { hasSnapshot: false },
  } satisfies PeaContextStateSignalArgs);

  expect(signal).toEqual(
    expect.objectContaining({
      id: "pea-workbench-context",
      cacheKey: "pea-workbench-context:15:active document17:Project A & B.rvt",
      mode: "snapshot",
      tagName: "pea-workbench-context",
      value: { entries: [{ description: "active document", value: "Project A & B.rvt" }] },
      attributes: { count: 1 },
    }),
  );
  expect(signal?.contents).toContain("<pea-workbench-context>");
  expect(signal?.contents).toContain("orientation, not truth");
  expect(signal?.contents).toContain("Project A &amp; B.rvt");
});

test("pea context state processor skips unchanged context when snapshot remains active", () => {
  const processor = new PeaContextStateProcessor();
  const requestContext = createRuntimeRequestContext({
    protocol: "tui",
    resourceId: "pea:test",
    entries: [{ description: "active document", value: "Project A.rvt" }],
  });

  const signal = processor.computeStateSignal({
    requestContext,
    contextWindow: { hasSnapshot: true },
    tracking: { currentCacheKey: "pea-workbench-context:15:active document13:Project A.rvt" },
  } satisfies PeaContextStateSignalArgs);

  expect(signal).toBeUndefined();
});

test("pea context state processor emits on changed or missing active snapshot", () => {
  const processor = new PeaContextStateProcessor();
  const requestContext = createRuntimeRequestContext({
    protocol: "tui",
    resourceId: "pea:test",
    entries: [{ description: "active document", value: "Project B.rvt" }],
  });

  const changed = processor.computeStateSignal({
    requestContext,
    contextWindow: { hasSnapshot: true },
    tracking: { currentCacheKey: "pea-workbench-context:15:active document13:Project A.rvt" },
  } satisfies PeaContextStateSignalArgs);
  const reemitted = processor.computeStateSignal({
    requestContext,
    contextWindow: { hasSnapshot: false },
    tracking: { currentCacheKey: "pea-workbench-context:15:active document13:Project B.rvt" },
  } satisfies PeaContextStateSignalArgs);

  expect(changed).toEqual(expect.objectContaining({ mode: "snapshot" }));
  expect(reemitted).toEqual(expect.objectContaining({ mode: "snapshot" }));
});

test(
  "pea runtime starts in yolo mode so tool approvals are auto-allowed",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-yolo-"));
    const runtime = await createPeaRuntime({ workspaceRoot });

    try {
      expect(runtime.session?.state.get()).toEqual(expect.objectContaining({ yolo: true }));
    } finally {
      await runtime.close?.();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "pea runtime honors configured startup model",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-model-"));
    const runtime = await createPeaRuntime({
      workspaceRoot,
      modelId: "openai/gpt-5.5",
    });

    try {
      expect(runtime.session?.model.get()).toBe("openai/gpt-5.5");
    } finally {
      await runtime.close?.();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
  slowRuntimeTestTimeout,
);

test(
  "pea task tools keep memory context when durable execution passes sparse context",
  async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-task-context-"));
    const runtime = await createPeaRuntime({ workspaceRoot });

    try {
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
      await runtime.close?.();
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
