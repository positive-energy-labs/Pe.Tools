import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Harness } from "@mastra/core/harness";
import { createMastraCode } from "mastracode";
import {
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeSessions,
  type RuntimeCreateRequest,
  type RuntimeFactory,
  type RuntimeHandle,
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

  return createRuntimeFactory(
    descriptor,
    (request) => createPeCodeRuntimeHandle(options, request),
    {
      startupThread: {
        createTitle: "New thread",
        onThreadOpened: async ({ request, handle, selection }) => {
          const projectPath =
            request.workspaceRoot ?? request.cwd ?? options.workspaceRoot ?? options.cwd; // TODO: wtf is this. red flag that theres so many fallbacks imo
          if (projectPath && !selection.thread.metadata?.projectPath) {
            await handle.harness.setThreadSetting({
              key: "projectPath",
              value: projectPath,
            });
          }
          await persistDefaultSandboxAllowedPaths(handle.harness);
        },
      },
    },
  );
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

export async function persistDefaultSandboxAllowedPaths(
  harness: Pick<RuntimeHandle["harness"], "getState" | "setState" | "setThreadSetting">,
): Promise<string[]> {
  const state = harness.getState() as { sandboxAllowedPaths?: string[] };
  const current = Array.isArray(state.sandboxAllowedPaths) ? state.sandboxAllowedPaths : [];
  const next = mergeSandboxAllowedPaths(current);

  if (!samePathList(current, next)) {
    await harness.setState({ sandboxAllowedPaths: next } as never);
  }
  await harness.setThreadSetting({ key: "sandboxAllowedPaths", value: next });

  return next;
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

  return {
    harness,
    sessions: createRuntimeSessions(harness, {
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
    close: () => closeMastraCodeHarness(harness),
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

function samePathList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
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

async function closeMastraCodeHarness(harness: Harness<Record<string, unknown>>): Promise<void> {
  harness.abort();
  await (harness as ClosableHarness).getMastra?.()?.shutdown?.();
}
