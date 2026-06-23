import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { InputProcessor } from "@mastra/core/processors";
import { TaskSignalProvider } from "@mastra/core/signals";
import type { MastraTUIOptions } from "mastracode/tui";
import { PeHostClient } from "@pe/host-client";
import type { RequestContext } from "@mastra/core/request-context";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import {
  createMastraCodeAuthStorageContext,
  createPeaCloudGatewayRuntimeAuthProfile,
  createPeaProductStateStorageProfile,
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeHarness,
  createRuntimeMemoryProfile,
  createRuntimeMemoryOptions,
  createSystemPromptCapture,
  hasMastraCodeStoredAuth,
  resolveMastraCodeModel,
  type MastraCodeAuthStorage,
  type RuntimeAuthProfile,
  type RuntimeMemoryProfile,
  type RuntimeCreateRequest,
  type RuntimeDescriptor,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHandleServices,
  type RuntimeHarness,
  type RuntimeHarnessConfig,
  type RuntimeKernelOptions,
  type RuntimeStorageProfile,
  type RuntimeToolProfile,
  type WorkbenchSystemPromptSnapshot,
} from "@pe/runtime";
import {
  bundledPeaSkills,
  configurePeaProductToolContext,
  defaultPeaAgentModelId,
  materializeBundledPeaSkills,
  peaProductToolProfile,
  peaProductTools,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
} from "@pe/tools";
import { PeaContextSignalProvider } from "./context-signals.ts";
import { peaAgentInstructions } from "./instructions.ts";

export const peaRuntimeToolProfile = peaProductToolProfile;
export const defaultPeaRuntimeToolProfile: RuntimeToolProfile = peaRuntimeToolProfile;
export const defaultPeaRuntimeToolCatalog = peaRuntimeToolProfile.catalog;

export interface PeaRuntimeFactoryOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  config:
    | RuntimeHarnessConfig<TState>
    | ((request: RuntimeCreateRequest) => RuntimeHarnessConfig<TState>);
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  authStorage?: MastraCodeAuthStorage;
  metadata?: Record<string, unknown>;
  storageProfile?: RuntimeStorageProfile;
  memoryProfile?: RuntimeMemoryProfile<TState>;
  toolProfile?: RuntimeToolProfile;
  sessionOptions?: RuntimeKernelOptions;
  createHandle?: (request: RuntimeCreateRequest) => Promise<PeaRuntimeHandle<TState>>;
  /** Mutable system-prompt snapshot surfaced via workbench metadata. Defaults to the static instructions. */
  systemPrompt?: WorkbenchSystemPromptSnapshot;
}

export type PeaRuntimeServices = RuntimeHandleServices & {
  authStorage: MastraCodeAuthStorage;
  hookManager: undefined;
  mcpManager: undefined;
};

export type PeaRuntimeHandle<TState extends Record<string, unknown> = Record<string, unknown>> =
  RuntimeHandle<TState, PeaRuntimeServices, RuntimeHarness<TState>>;

export type PeaRuntimeFactory<TState extends Record<string, unknown> = Record<string, unknown>> =
  RuntimeFactory<TState, PeaRuntimeServices, RuntimeHarness<TState>>;

export interface PeaTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  modelId?: string;
}

export function createPeaRuntimeFactory<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: PeaRuntimeFactoryOptions<TState>): PeaRuntimeFactory<TState> {
  const descriptor =
    options.descriptor ??
    createRuntimeDescriptor("pea", {
      modeName: "Pea",
      agentName: "Pea",
      title: "Pea",
      description: "Positive Energy Revit/operator workbench.",
    });
  const auth = options.auth ?? createPeaRuntimeAuthProfile();
  const storageProfile = options.storageProfile ?? createPeaProductStateStorageProfile();
  const memoryProfile =
    options.memoryProfile ?? createRuntimeMemoryProfile<TState>({ id: "pea-memory" });
  const memoryOptions = createRuntimeMemoryOptions(undefined);
  const toolProfile = options.toolProfile ?? peaRuntimeToolProfile;

  return createRuntimeFactory<TState, PeaRuntimeServices, RuntimeHarness<TState>>(
    descriptor,
    async (request) => {
      if (options.createHandle) return options.createHandle(request);

      const config = peaRuntimeHarnessConfig(options.config, request);
      const configuredRoot = config.initialState?.projectPath;
      const workspaceRoot = typeof configuredRoot === "string" ? configuredRoot : undefined;
      return createRuntimeHarness<TState, PeaRuntimeServices>({
        config,
        request,
        auth,
        authStorage: options.authStorage,
        storageProfile,
        memoryProfile,
        toolProfile,
        sessionOptions: options.sessionOptions,
        workspace: {
          cwd: workspaceRoot ?? request.cwd,
          root: workspaceRoot ?? request.workspaceRoot,
        },
        metadata: {
          ...options.metadata,
          runtimeId: descriptor.id,
          storageProfileId: storageProfile.id,
          memoryProfileId: memoryProfile.id,
          toolProfileId: toolProfile.id,
          protocol: request.protocol,
          cwd: workspaceRoot ?? request.cwd,
          workspaceRoot: workspaceRoot ?? request.workspaceRoot,
          workbench: {
            systemPrompt: options.systemPrompt ?? {
              content: peaAgentInstructions,
              source: "Pea agent instructions",
            },
            contextWindow: 200_000,
            agents: ["Pea Revit Agent"],
            skills: bundledPeaSkills.map((skill) => ({
              name: skill.name,
              approxTokens: Math.ceil(skill.content.length / 4),
            })),
            observationalMemory: {
              id: "pea-memory:observational-config",
              kind: "observation",
              status: "activated",
              title: "Observational memory configuration",
              summary: "Thread-scoped observational memory is configured for Pea.",
              raw: memoryOptions.observationalMemory,
            },
          },
        },
      });
    },
    auth,
  );
}

function peaRuntimeHarnessConfig<TState extends Record<string, unknown>>(
  config: PeaRuntimeFactoryOptions<TState>["config"],
  request: RuntimeCreateRequest,
): RuntimeHarnessConfig<TState> {
  return typeof config === "function" ? config(request) : config;
}

export async function createPeaProtocolRuntimeFactory(
  options: PeaTuiRuntimeOptions = {},
): Promise<PeaRuntimeFactory> {
  const productHomePath = resolvePeaProductHomePath();
  const workspaceRoot = path.resolve(options.workspaceRoot ?? options.cwd ?? productHomePath);
  const hostBaseUrl = PeHostClient.resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = PeHostClient.resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });
  const authStorageContext = await createMastraCodeAuthStorageContext();
  const authStorage = authStorageContext.storage;

  await materializeBundledPeaSkills({ productHomePath });

  const promptCapture = createSystemPromptCapture({
    content: peaAgentInstructions,
    source: "Pea agent instructions",
  });

  return createPeaRuntimeFactory<Record<string, unknown>>({
    systemPrompt: promptCapture.snapshot,
    config: () => ({
      id: "pea",
      resourceId: createLocalResourceId("pea", workspaceRoot),
      workspace: createPeaWorkspace({ productHomePath, workspaceRoot }),
      modes: [
        {
          id: "agent",
          name: "Agent",
          default: true,
          defaultModelId: defaultPeaAgentModelId,
          color: "#22c55e",
          agent: createPeaAgent(promptCapture.processor),
        },
      ],
      tools: peaProductTools,
      initialState: {
        currentModelId: options.modelId ?? defaultPeaAgentModelId,
        projectPath: workspaceRoot,
        productHomePath,
        configDir: ".pea",
        bundledSkillCount: bundledPeaSkills.length,
        yolo: true,
      },
      modelAuthChecker: (provider) =>
        hasMastraCodeStoredAuth(authStorage, provider) ? true : undefined,
    }),
    authStorage,
    metadata: {
      authStorageSource: authStorageContext.source,
      authStorageApiKeyProviders: Object.keys(authStorageContext.apiKeyEnvVars),
    },
  });
}

function createPeaAgent(captureProcessor?: InputProcessor): Agent {
  return new Agent({
    id: "pea-agent",
    name: "Pea Revit Agent",
    description: "High-trust Revit/operator agent for Positive Energy tooling.",
    instructions: peaAgentInstructions,
    model: ({ requestContext }) => resolveCurrentModel(requestContext, defaultPeaAgentModelId),
    signals: [new TaskSignalProvider(), new PeaContextSignalProvider()],
    tools: peaProductTools,
    inputProcessors: captureProcessor ? [captureProcessor] : undefined,
  });
}

function createPeaWorkspace(options: {
  productHomePath: string;
  workspaceRoot: string;
}): Workspace {
  return new Workspace({
    id: "pea-workspace",
    name: "Pea Workspace",
    filesystem: new LocalFilesystem({
      basePath: options.workspaceRoot,
      contained: true,
    }),
    sandbox: new LocalSandbox({
      workingDirectory: options.workspaceRoot,
      env: process.env,
    }),
    skills: resolvePeaSkillPaths({ productHomePath: options.productHomePath }),
  });
}

export async function createPeaTuiRuntime(
  options: PeaTuiRuntimeOptions = {},
): Promise<PeaRuntimeHandle> {
  const workspaceRoot = path.resolve(
    options.workspaceRoot ?? options.cwd ?? resolvePeaProductHomePath(),
  );
  const factory = await createPeaProtocolRuntimeFactory(options);
  return factory.create({
    protocol: "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  });
}

export async function runPeaTui(options: PeaTuiRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaTuiRuntime(options);
  const { MastraTUI } = await import("mastracode/tui");
  const tuiOptions: MastraTUIOptions = {
    harness: runtime.harness,
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    appName: "Pea",
    version: "0.1.0",
  };
  const tui = new MastraTUI(tuiOptions);
  await tui.run();
}

export function createPeaRuntimeAuthProfile(
  options: {
    source?: string;
    allowOauthBetaAuth?: boolean;
    logout?: () => Promise<void>;
  } = {},
): RuntimeAuthProfile {
  return createPeaCloudGatewayRuntimeAuthProfile({
    ...options,
    apiKeyDescription: "Use OPENAI_API_KEY only as a local Pea model-access escape hatch.",
  });
}

function resolveCurrentModel(
  requestContext: RequestContext,
  fallbackModelId: string,
): Promise<MastraModelConfig> {
  const harness = readStateHarness(requestContext.get("harness"));
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

function readStateHarness(
  value: unknown,
): { getState?: () => Record<string, unknown> } | undefined {
  return isRecord(value) && typeof value.getState === "function" ? value : undefined;
}

function isThinkingLevel(value: unknown): value is "off" | "low" | "medium" | "high" | "xhigh" {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
