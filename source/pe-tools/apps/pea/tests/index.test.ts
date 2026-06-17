import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  createRuntimeAcpCliOptions,
  createRuntimeAgUiCliOptions,
  createRuntimeRequestContext,
} from "@pe/runtime";
import { bundledPeaSkills, peaStandardSkillsRoot } from "@pe/tools";
import {
  createPeaCliCommand,
  createPeaBetaTuiWorkbenchOptions,
  createPeaProtocolRuntimeFactory,
  defaultPeaRuntimeToolCatalog,
  defaultPeaRuntimeToolProfile,
  getPeaCliCommandNames,
  PeaContextSignalProvider,
  PeaContextStateProcessor,
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
      "modelId",
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

test("pea context signal provider exposes a snapshot state processor", () => {
  const provider = new PeaContextSignalProvider();

  expect(provider.getInputProcessors()).toEqual([
    expect.objectContaining({ id: "pea-context-state", stateId: "pea-workbench-context" }),
  ]);
});

test("pea beta TUI keeps line-mode fallback enabled", () => {
  expect(createPeaBetaTuiWorkbenchOptions({} as never, "C:/repo")).toEqual(
    expect.objectContaining({
      cwd: "C:/repo",
      title: "Pea beta TUI",
      fallbackToLineMode: true,
    }),
  );
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
  } as any);

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
  } as any);

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
  } as any);
  const reemitted = processor.computeStateSignal({
    requestContext,
    contextWindow: { hasSnapshot: false },
    tracking: { currentCacheKey: "pea-workbench-context:15:active document13:Project B.rvt" },
  } as any);

  expect(changed).toEqual(expect.objectContaining({ mode: "snapshot" }));
  expect(reemitted).toEqual(expect.objectContaining({ mode: "snapshot" }));
});

test("pea protocol runtime starts in yolo mode so tool approvals are auto-allowed", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-yolo-"));
  const runtime = await (
    await createPeaProtocolRuntimeFactory({ workspaceRoot })
  ).create({
    protocol: "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  });

  try {
    expect(runtime.harness.getState()).toEqual(expect.objectContaining({ yolo: true }));
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("pea protocol runtime does not preselect a startup thread", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-no-startup-thread-"));
  const runtime = await (
    await createPeaProtocolRuntimeFactory({ workspaceRoot })
  ).create({
    protocol: "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  });

  try {
    expect(runtime.harness.getCurrentThreadId() ?? undefined).toBeUndefined();
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("pea protocol runtime honors configured startup model", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-model-"));
  const runtime = await (
    await createPeaProtocolRuntimeFactory({
      workspaceRoot,
      modelId: "openai/gpt-5.5",
    })
  ).create({
    protocol: "acp",
    cwd: workspaceRoot,
    workspaceRoot,
  });

  try {
    expect(runtime.harness.getState()).toEqual(
      expect.objectContaining({ currentModelId: "openai/gpt-5.5" }),
    );
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("pea task tools keep memory context when durable execution passes sparse context", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-task-context-"));
  const runtime = await (
    await createPeaProtocolRuntimeFactory({ workspaceRoot })
  ).create({
    protocol: "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  });

  try {
    const session = await runtime.sessions.createThreadSession({ title: "Task Context" });
    const requestContext = createRuntimeRequestContext({
      protocol: "tui",
      resourceId: session.resourceId,
    });
    const tools = await (runtime.harness as any).getCurrentAgent().getToolsForExecution({
      threadId: session.threadId,
      resourceId: session.resourceId,
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

    expect(result).toEqual(expect.objectContaining({ isError: false }));
    expect(result.content).not.toContain("Task tools require agent memory");
    expect(check.summary).toEqual(
      expect.objectContaining({ total: 1, incomplete: 1, hasTasks: true }),
    );
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
