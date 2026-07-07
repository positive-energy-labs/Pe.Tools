import { readdir } from "node:fs/promises";
import path from "node:path";
import { createMastraCode, type MastraCodeConfig } from "mastracode";
import type { MastraTUIOptions } from "mastracode/tui";
import { runRuntimeAcpAgent } from "@pe/runtime";
import { peCodeRuntimeToolProfile as peCodeToolsRuntimeToolProfile } from "@pe/mcps";

export const peCodeRuntimeToolProfile = peCodeToolsRuntimeToolProfile;
export const defaultPeCodeRuntimeToolProfile = peCodeRuntimeToolProfile;
export const defaultPeCodeRuntimeToolCatalog = peCodeRuntimeToolProfile.catalog;
export const defaultPeCodeSandboxAllowedPath = "C:/Users/kaitp/source/repos";

export interface PeCodeTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  modelId?: string;
  additionalDirectories?: string[];
}

type PeCodeRuntime = Awaited<ReturnType<typeof createMastraCode>>;
type PeCodeSession = NonNullable<PeCodeRuntime["session"]>;
type PeCodeRuntimeWithSession = PeCodeRuntime & {
  session: PeCodeSession;
};
type MastraCodeStaticExtraTools = Extract<
  NonNullable<MastraCodeConfig["extraTools"]>,
  Record<string, unknown>
>;
type MastraCodeExtraTool = MastraCodeStaticExtraTools[string];
type PeCodeTool =
  (typeof peCodeRuntimeToolProfile.tools)[keyof typeof peCodeRuntimeToolProfile.tools];

export async function createPeCodeTuiRuntime(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<PeCodeRuntimeWithSession> {
  const startPath = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const cwd = await resolveDevAgentProjectRoot(startPath);
  return createPeCodeRuntime({
    ...options,
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
    controller: runtime.controller,
    session: runtime.session,
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    appName: "peco (Pe.Tools)",
    version: "0.1.0",
  };
  const tui = new MastraTUI(tuiOptions);
  try {
    await tui.run();
  } finally {
    await closePeCodeRuntime(runtime);
  }
}

export async function runPeCodeAcp(options: PeCodeTuiRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeCodeRuntime(options);
  await runRuntimeAcpAgent({
    controller: runtime.controller,
    session: runtime.session,
    modes: runtime.controller.listModes(),
    cleanup: () => closePeCodeRuntime(runtime),
  });
}

export async function createPeCodeRuntime(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<PeCodeRuntimeWithSession> {
  const startPath = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const cwd = await resolveDevAgentProjectRoot(startPath);
  process.chdir(cwd);

  const sandboxAllowedPaths = mergeSandboxAllowedPaths(options.additionalDirectories ?? []);
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
  return requirePeCodeSession(runtime);
}

const peCodeExtraTools = createMastraCodeExtraTools(
  peCodeRuntimeToolProfile.tools,
  "request_access",
);

function createMastraCodeExtraTools(
  tools: typeof peCodeRuntimeToolProfile.tools,
  omittedToolName: string,
): Record<string, MastraCodeExtraTool> {
  const extraTools: Record<string, MastraCodeExtraTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (name === omittedToolName) continue;
    extraTools[name] = adaptMastraCodeExtraTool(tool);
  }
  return extraTools;
}

function adaptMastraCodeExtraTool(tool: PeCodeTool): MastraCodeExtraTool {
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

export async function closePeCodeRuntime(runtime: PeCodeRuntimeWithSession): Promise<void> {
  runtime.session.abort();
  await runtime.session.thread.clearAndReleaseLock();
  await runtime.mcpManager?.disconnect?.();
  await runtime.controller.getMastra()?.stopWorkers?.();
  await runtime.controller.stopHeartbeats();
  await closeSignalsPubSub(runtime.signalsPubSub);
}

async function closeSignalsPubSub(pubSub: unknown): Promise<void> {
  const close = (pubSub as { close?: () => Promise<void> | void } | undefined)?.close;
  await close?.();
}

function requirePeCodeSession(runtime: PeCodeRuntime): PeCodeRuntimeWithSession {
  if (!runtime.session) throw new Error("Expected Peco runtime session.");
  return runtime as PeCodeRuntimeWithSession;
}
