import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Harness } from "@mastra/core/harness";
import { createMastraCode, type MastraCodeConfig } from "mastracode";
import type { MastraTUIOptions } from "mastracode/tui";
import {
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeKernel,
  createRuntimeThreadLock,
  resolveRuntimeThreadStateStore,
  type RuntimeCreateRequest,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHandleServices,
  type RuntimeKernelHarness,
  type RuntimeKernel,
  type RuntimeToolsInput,
  type RuntimeToolProfile,
} from "@pe/runtime";
import { peCodeRuntimeToolProfile as peCodeToolsRuntimeToolProfile } from "@pe/tools";

export const peCodeRuntimeToolProfile = peCodeToolsRuntimeToolProfile;
export const defaultPeCodeRuntimeToolProfile: RuntimeToolProfile = peCodeRuntimeToolProfile;
export const defaultPeCodeRuntimeToolCatalog = peCodeRuntimeToolProfile.catalog;
export const defaultPeCodeSandboxAllowedPath = "C:/Users/kaitp/source/repos";

export interface PeCodeTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  modelId?: string;
}

type PeCodeRuntime = Awaited<ReturnType<typeof createMastraCode>>;
type PeCodeHarness = PeCodeRuntime["harness"];
type PeCodeState = PeCodeHarness extends Harness<infer TState> ? TState : Record<string, unknown>;
type PeCodeRuntimeServices = RuntimeHandleServices &
  Pick<PeCodeRuntime, "authStorage" | "hookManager" | "mcpManager">;
type PeCodeRuntimeHandle = RuntimeHandle<PeCodeState, PeCodeRuntimeServices, PeCodeHarness>;
type PeCodeRuntimeFactory = RuntimeFactory<PeCodeState, PeCodeRuntimeServices, PeCodeHarness>;
type MastraCodeStaticExtraTools = Extract<
  NonNullable<MastraCodeConfig["extraTools"]>,
  Record<string, unknown>
>;
type MastraCodeExtraTool = MastraCodeStaticExtraTools[string];

export async function createPeCodeProtocolRuntimeFactory(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<PeCodeRuntimeFactory> {
  const descriptor = createRuntimeDescriptor("peco", {
    modeName: "Build",
    agentName: "Pe.Tools Dev Agent",
    title: "peco",
    description: "Pe.Tools repo coding agent.",
  });

  return createRuntimeFactory<PeCodeState, PeCodeRuntimeServices, PeCodeHarness>(
    descriptor,
    (request) => createPeCodeRuntimeHandle(options, request),
  );
}

export async function createPeCodeTuiRuntime(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<PeCodeRuntimeHandle> {
  const startPath = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const cwd = await resolveDevAgentProjectRoot(startPath);
  const factory = await createPeCodeProtocolRuntimeFactory({
    ...options,
    cwd,
    workspaceRoot: cwd,
  });
  return factory.create({
    protocol: "tui",
    cwd,
    workspaceRoot: cwd,
  });
}

export async function runPeCodeTui(options: PeCodeTuiRuntimeOptions = {}): Promise<void> {
  const startPath = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const cwd = await resolveDevAgentProjectRoot(startPath);
  const runtime = await createPeCodeTuiRuntime({
    ...options,
    cwd,
    workspaceRoot: cwd,
  });
  const { MastraTUI } = await import("mastracode/tui");
  const tuiOptions: MastraTUIOptions = {
    harness: runtime.harness,
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    appName: "peco (Pe.Tools)",
    version: "0.1.0",
  };
  const tui = new MastraTUI(tuiOptions);
  await tui.run();
}

async function createPeCodeRuntimeHandle(
  options: PeCodeTuiRuntimeOptions,
  request: RuntimeCreateRequest,
): Promise<PeCodeRuntimeHandle> {
  const startPath = path.resolve(
    request.workspaceRoot ?? request.cwd ?? options.workspaceRoot ?? options.cwd ?? process.cwd(),
  );
  const cwd = await resolveDevAgentProjectRoot(startPath);
  process.chdir(cwd);

  const sandboxAllowedPaths = mergeSandboxAllowedPaths(request.additionalDirectories ?? []);
  const runtime = await createMastraCode({
    cwd,
    // default is configDir: ".mastracode",
    extraTools: peCodeExtraTools,
    disabledTools: ["string_replace_lsp", "ast_smart_edit", "lsp_inspect"], // this doesn't seem to apply?
    initialState: {
      ...(options.modelId ? { currentModelId: options.modelId } : {}),
      sandboxAllowedPaths,
      yolo: true,
    },
  });
  const harness = runtime.harness;
  const kernel = createRuntimeKernel(harness, {
    threadStateStore: resolveRuntimeThreadStateStore(harness),
    toolCatalog: peCodeRuntimeToolProfile.catalog,
  });

  return {
    harness,
    kernel,
    workspace: { cwd, root: cwd },
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    metadata: {
      runtimeId: "peco",
      protocol: request.protocol,
      cwd: request.cwd,
      workspaceRoot: request.workspaceRoot,
      workbench: {
        contextEntries: [
          {
            id: "peco-system-prompt-availability",
            title: "System prompt availability",
            content:
              "peco's agent is owned by stock createMastraCode, which exposes no inputProcessors hook, so the @pe/runtime system-prompt capture processor (used by pea) cannot be attached yet. The resolved prompt will be inspectable once peco moves to a custom agent.",
            source: "peco runtime",
          },
          {
            id: "peco-memory-authority",
            title: "Observational memory authority",
            content:
              "peco delegates memory and observational-memory behavior to MastraCode. Exact live OM entries are not exposed through current runtime hooks.",
            source: "peco runtime",
          },
        ],
        observationalMemory: {
          id: "peco-memory:mastracode",
          kind: "observation",
          status: "activated",
          title: "MastraCode memory",
          summary: "MastraCode owns peco memory and OM configuration.",
          raw: { owner: "mastracode" },
        },
      },
    },
    close: () => closePeCodeRuntime(harness, kernel),
  };
}

const peCodeExtraTools = createMastraCodeExtraTools(
  peCodeRuntimeToolProfile.tools,
  "request_access",
);

function createMastraCodeExtraTools(
  tools: RuntimeToolsInput,
  omittedToolName: string,
): Record<string, MastraCodeExtraTool> {
  const extraTools: Record<string, MastraCodeExtraTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (name === omittedToolName) continue;
    extraTools[name] = adaptMastraCodeExtraTool(tool);
  }
  return extraTools;
}

function adaptMastraCodeExtraTool(tool: RuntimeToolsInput[string]): MastraCodeExtraTool {
  const adapted: MastraCodeExtraTool = {};
  Object.setPrototypeOf(adapted, Object.getPrototypeOf(tool));
  Object.defineProperties(adapted, Object.getOwnPropertyDescriptors(tool));

  if (isMastraCodeToolExecute(adapted.execute)) {
    const execute = adapted.execute.bind(tool);
    adapted.execute = (input, context) => execute(input, context);
  }

  return adapted;
}

function isMastraCodeToolExecute(
  value: unknown,
): value is NonNullable<MastraCodeExtraTool["execute"]> {
  return typeof value === "function";
}

function mergeSandboxAllowedPaths(paths: string[]): string[] {
  return Array.from(
    new Set([defaultPeCodeSandboxAllowedPath, ...paths].map((entry) => path.resolve(entry))),
  );
}

async function resolveDevAgentProjectRoot(startPath: string): Promise<string> {
  let current = startPath;

  while (true) {
    const entries = await readDirectoryEntries(current);
    if (
      entries.some(
        (entry) => entry.isFile() && (entry.name.endsWith(".slnx") || entry.name.endsWith(".sln")),
      )
    )
      return current;

    if (entries.some((entry) => entry.name === ".git")) return current;

    const parent = path.dirname(current);
    if (parent === current) return startPath;

    current = parent;
  }
}

async function readDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function closePeCodeRuntime(
  harness: RuntimeKernelHarness<PeCodeState>,
  kernel: RuntimeKernel,
): Promise<void> {
  const currentThreadId = harness.getCurrentThreadId();
  harness.abort();
  try {
    await kernel.flushLedger();
  } finally {
    releasePeCodeThreadLock(currentThreadId);
    await harness.getMastra?.()?.shutdown?.();
  }
}

function releasePeCodeThreadLock(threadId: string | null | undefined): void {
  if (!threadId) return;
  try {
    createRuntimeThreadLock({ storageProfileKind: "mastracode-compatible" }).release(threadId);
  } catch {
    // Best-effort cleanup mirrors the generic runtime harness close path.
  }
}
