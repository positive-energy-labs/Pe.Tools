import { readdir } from "node:fs/promises";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import {
  LocalFilesystem,
  LocalSandbox,
  Workspace,
} from "@mastra/core/workspace";
import {
  createMastraCodeStorageProfile,
  createOpenAiRuntimeAuthProfile,
  createPeCodeRuntimeMemoryProfile,
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeHarness,
  resolveMastraCodeModel,
  type RuntimeAuthProfile,
  type RuntimeMemoryProfile,
  type RuntimeCreateRequest,
  type RuntimeDescriptor,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHarnessConfig,
  type RuntimeStorageProfile,
  type RuntimeToolProfile,
} from "@pe/runtime";
import { peCodeRuntimeToolProfile as peCodeToolsRuntimeToolProfile } from "@pe/tools";
import { instructions } from "./instructions.ts";
import { ensureDevAgentProjectFiles } from "./project-files.ts";

export const peCodeRuntimeToolProfile = peCodeToolsRuntimeToolProfile;
export const defaultPeCodeRuntimeToolProfile: RuntimeToolProfile =
  peCodeRuntimeToolProfile;
export const defaultPeCodeRuntimeToolCatalog = peCodeRuntimeToolProfile.catalog;

export interface PeCodeRuntimeFactoryOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  config: RuntimeHarnessConfig<TState>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  authStorage?: unknown;
  metadata?: Record<string, unknown>;
  storageProfile?: RuntimeStorageProfile;
  memoryProfile?: RuntimeMemoryProfile<TState>;
  toolProfile?: RuntimeToolProfile;
  createHandle?: (
    request: RuntimeCreateRequest,
  ) => Promise<RuntimeHandle<TState>>;
}

export interface PeCodeTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  modelId?: string;
}

export function createPeCodeRuntimeFactory<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: PeCodeRuntimeFactoryOptions<TState>): RuntimeFactory<TState> {
  const descriptor =
    options.descriptor ??
    createRuntimeDescriptor("peco", {
      modeName: "Build",
      agentName: "Pe.Tools Dev Agent",
      title: "peco",
      description: "Pe.Tools repo coding agent.",
    });
  const auth = options.auth ?? createPeCodeRuntimeAuthProfile();
  const storageProfile =
    options.storageProfile ?? createMastraCodeStorageProfile();
  const memoryProfile =
    options.memoryProfile ?? createPeCodeRuntimeMemoryProfile<TState>();
  const toolProfile = options.toolProfile ?? peCodeRuntimeToolProfile;

  return createRuntimeFactory(
    descriptor,
    async (request) =>
      options.createHandle?.(request) ??
      createRuntimeHarness<TState>({
        config: options.config,
        request,
        auth,
        authStorage: options.authStorage,
        storageProfile,
        memoryProfile,
        toolProfile,
        metadata: {
          ...options.metadata,
          runtimeId: descriptor.id,
          storageProfileId: storageProfile.id,
          memoryProfileId: memoryProfile.id,
          toolProfileId: toolProfile.id,
          protocol: request.protocol,
          cwd: request.cwd,
          workspaceRoot: request.workspaceRoot,
        },
      }),
    auth,
  );
}

export async function createPeCodeProtocolRuntimeFactory(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<RuntimeFactory> {
  const startPath = path.resolve(
    options.workspaceRoot ?? options.cwd ?? process.cwd(),
  );
  const cwd = await resolveDevAgentProjectRoot(startPath);
  const authStorage = await createMastraCodeAuthStorage();
  loadStoredApiKeysIntoEnv(authStorage);
  await ensureDevAgentProjectFiles(cwd);

  const defaultModelId = options.modelId ?? "openai/gpt-5.5";
  const agent = new Agent({
    id: "code-agent",
    name: "Pe.Tools Dev Agent",
    description: "Pe.Tools repo coding agent.",
    instructions,
    model: ({ requestContext }) =>
      resolveCurrentModel(requestContext, defaultModelId),
    tools: peCodeRuntimeToolProfile.tools,
  });
  const workspace = new Workspace({
    id: "peco-workspace",
    name: "Pe.Tools Repo Workspace",
    filesystem: new LocalFilesystem({ basePath: cwd, contained: true }),
    sandbox: new LocalSandbox({ workingDirectory: cwd, env: process.env }),
    skills: [".mastracode/skills", ".agents/skills", ".claude/skills"],
  });

  process.chdir(cwd);

  return createPeCodeRuntimeFactory<Record<string, unknown>>({
    config: {
      id: "peco",
      resourceId: createLocalResourceId("peco", cwd),
      workspace,
      modes: [
        {
          id: "build",
          name: "Build",
          default: true,
          defaultModelId,
          color: "#2563eb",
          agent,
        },
      ],
      tools: peCodeRuntimeToolProfile.tools,
      initialState: {
        currentModelId: defaultModelId,
        yolo: true,
        configDir: ".mastracode",
      },
      modelAuthChecker: (provider) =>
        hasStoredAuth(authStorage, provider) ? true : undefined,
    },
    authStorage,
  });
}

export async function createPeCodeTuiRuntime(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<RuntimeHandle> {
  const startPath = path.resolve(
    options.workspaceRoot ?? options.cwd ?? process.cwd(),
  );
  const cwd = await resolveDevAgentProjectRoot(startPath);
  const factory = await createPeCodeProtocolRuntimeFactory(options);
  return factory.create({
    protocol: "tui",
    cwd,
    workspaceRoot: cwd,
  });
}

export async function runPeCodeTui(
  options: PeCodeTuiRuntimeOptions = {},
): Promise<void> {
  const runtime = await createPeCodeTuiRuntime(options);
  const { MastraTUI } = await import("mastracode/tui");
  const tui = new MastraTUI({
    harness: runtime.harness,
    authStorage: runtime.authStorage as never,
    appName: "peco (Pe.Tools)",
    version: "0.1.0",
  });
  await tui.run();
}

export function createPeCodeRuntimeAuthProfile(
  options: {
    source?: string;
    allowOauthBetaAuth?: boolean;
  } = {},
): RuntimeAuthProfile {
  return createOpenAiRuntimeAuthProfile({
    ...options,
    apiKeyDescription:
      "Use OPENAI_API_KEY or stored peco API-key credentials for model access.",
  });
}

async function resolveDevAgentProjectRoot(startPath: string): Promise<string> {
  let current = startPath;

  while (true) {
    const entries = await readDirectoryEntries(current);
    if (
      entries.some(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith(".slnx") || entry.name.endsWith(".sln")),
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

function resolveCurrentModel(
  requestContext: RequestContext,
  fallbackModelId: string,
): Promise<MastraModelConfig> {
  const harness = requestContext.get("harness") as
    | { getState?: () => Record<string, unknown> }
    | undefined;
  const state = harness?.getState?.();
  const modelId =
    typeof state?.currentModelId === "string" && state.currentModelId.length > 0
      ? state.currentModelId
      : fallbackModelId;
  const thinkingLevel = state?.thinkingLevel;

  return resolveMastraCodeModel(modelId, {
    thinkingLevel: isThinkingLevel(thinkingLevel) ? thinkingLevel : undefined,
    remapForCodexOAuth: true,
    requestContext,
  });
}

async function createMastraCodeAuthStorage(): Promise<unknown> {
  const module = (await import("mastracode")) as {
    createAuthStorage(): unknown;
  };
  return module.createAuthStorage();
}

function loadStoredApiKeysIntoEnv(authStorage: unknown): void {
  const storage = authStorage as {
    loadStoredApiKeysIntoEnv?: (providers: Record<string, string>) => void;
  };
  storage.loadStoredApiKeysIntoEnv?.({
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    groq: "GROQ_API_KEY",
    xai: "XAI_API_KEY",
  });
}

function hasStoredAuth(authStorage: unknown, provider: string): boolean {
  const storage = authStorage as {
    hasStoredApiKey?: (provider: string) => boolean;
    isLoggedIn?: (provider: string) => boolean;
  };
  return Boolean(
    storage.hasStoredApiKey?.(provider) || storage.isLoggedIn?.(provider),
  );
}

function isThinkingLevel(
  value: unknown,
): value is "off" | "low" | "medium" | "high" | "xhigh" {
  return (
    value === "off" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function createLocalResourceId(runtimeId: string, cwd: string): string {
  return `${runtimeId}:${Buffer.from(cwd).toString("base64url")}`;
}
