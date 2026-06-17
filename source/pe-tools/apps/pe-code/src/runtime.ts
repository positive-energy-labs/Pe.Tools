import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Harness } from "@mastra/core/harness";
import { createMastraCode } from "mastracode";
import {
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeKernel,
  createRuntimeThreadLock,
  createRuntimeSessions,
  resolveRuntimeThreadStateStore,
  type RuntimeCreateRequest,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeKernel,
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

export async function createPeCodeProtocolRuntimeFactory(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<RuntimeFactory> {
  const descriptor = createRuntimeDescriptor("peco", {
    modeName: "Build",
    agentName: "Pe.Tools Dev Agent",
    title: "peco",
    description: "Pe.Tools repo coding agent.",
  });

  return createRuntimeFactory(descriptor, (request) => createPeCodeRuntimeHandle(options, request));
}

export async function createPeCodeTuiRuntime(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<RuntimeHandle> {
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
  const tui = new MastraTUI({
    harness: runtime.harness,
    authStorage: runtime.authStorage as never,
    hookManager: runtime.hookManager as never,
    mcpManager: runtime.mcpManager as never,
    appName: "peco (Pe.Tools)",
    version: "0.1.0",
  });
  await tui.run();
}

async function createPeCodeRuntimeHandle(
  options: PeCodeTuiRuntimeOptions,
  request: RuntimeCreateRequest,
): Promise<RuntimeHandle> {
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
  const harness = runtime.harness as unknown as Harness<Record<string, unknown>>;
  const kernel = createRuntimeKernel(harness, {
    threadStateStore: resolveRuntimeThreadStateStore(harness),
    toolCatalog: peCodeRuntimeToolProfile.catalog,
  });

  return {
    harness,
    kernel,
    sessions: createRuntimeSessions(harness, {
      kernel,
      toolCatalog: peCodeRuntimeToolProfile.catalog,
    }),
    workspace: { cwd, root: cwd },
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    metadata: {
      runtimeId: "peco",
      protocol: request.protocol,
      cwd: request.cwd,
      workspaceRoot: request.workspaceRoot,
    },
    close: () => closePeCodeRuntime(harness, kernel),
  };
}

type MastraCodeExtraTool = {
  execute?: (input: unknown, context?: unknown) => unknown;
  [key: string]: unknown;
};

const peCodeExtraTools = Object.fromEntries(
  Object.entries(peCodeRuntimeToolProfile.tools).filter(([name]) => name !== "request_access"),
) as unknown as Record<string, MastraCodeExtraTool>;

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

type ClosableHarness = Harness<Record<string, unknown>> & {
  getMastra?: () => { shutdown?: () => Promise<void> | void } | undefined;
};

async function closePeCodeRuntime(
  harness: Harness<Record<string, unknown>>,
  kernel: RuntimeKernel,
): Promise<void> {
  const currentThreadId = harness.getCurrentThreadId();
  harness.abort();
  try {
    await kernel.flushLedger();
  } finally {
    releasePeCodeThreadLock(currentThreadId);
    await (harness as ClosableHarness).getMastra?.()?.shutdown?.();
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
