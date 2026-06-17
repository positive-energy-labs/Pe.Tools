import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { TaskSignalProvider } from "@mastra/core/signals";
import { createInProcessAcpWorkbenchClient } from "@pe/acp-client";
import { PeHostClient } from "@pe/host-client";
import type { WorkbenchAgentClient } from "@pe/workbench-core";
import type { RequestContext } from "@mastra/core/request-context";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import {
  createMastraCodeAuthStorageContext,
  createPeaCloudGatewayRuntimeAuthProfile,
  createPeaProductStateStorageProfile,
  createRuntimeAcpAgent,
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeHarness,
  createRuntimeMemoryProfile,
  hasMastraCodeStoredAuth,
  resolveMastraCodeModel,
  type MastraCodeAuthStorage,
  type RuntimeAuthProfile,
  type RuntimeMemoryProfile,
  type RuntimeCreateRequest,
  type RuntimeDescriptor,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHarnessConfig,
  type RuntimeSessionOptions,
  type RuntimeStorageProfile,
  type RuntimeToolProfile,
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
  config: RuntimeHarnessConfig<TState>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  authStorage?: MastraCodeAuthStorage;
  metadata?: Record<string, unknown>;
  storageProfile?: RuntimeStorageProfile;
  memoryProfile?: RuntimeMemoryProfile<TState>;
  toolProfile?: RuntimeToolProfile;
  sessionOptions?: RuntimeSessionOptions;
  createHandle?: (request: RuntimeCreateRequest) => Promise<RuntimeHandle<TState>>;
}

export interface PeaTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  modelId?: string;
}

export interface PeaBetaTuiWorkbenchOptions {
  client: WorkbenchAgentClient;
  cwd: string;
  title: string;
  fallbackToLineMode: true;
}

export function createPeaRuntimeFactory<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: PeaRuntimeFactoryOptions<TState>): RuntimeFactory<TState> {
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
  const toolProfile = options.toolProfile ?? peaRuntimeToolProfile;
  const configuredRoot = options.config.initialState?.projectPath;
  const workspaceRoot = typeof configuredRoot === "string" ? configuredRoot : undefined;

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
        },
      }),
    auth,
  );
}

export async function createPeaProtocolRuntimeFactory(
  options: PeaTuiRuntimeOptions = {},
): Promise<RuntimeFactory> {
  const productHomePath = resolvePeaProductHomePath();
  const workspaceRoot = productHomePath;
  const hostBaseUrl = PeHostClient.resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = PeHostClient.resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });
  const authStorageContext = await createMastraCodeAuthStorageContext();
  const authStorage = authStorageContext.storage;

  await materializeBundledPeaSkills({ productHomePath });

  const agent = new Agent({
    id: "pea-agent",
    name: "Pea Revit Agent",
    description: "High-trust Revit/operator agent for Positive Energy tooling.",
    instructions: peaAgentInstructions,
    model: ({ requestContext }) => resolveCurrentModel(requestContext, defaultPeaAgentModelId),
    signals: [new TaskSignalProvider(), new PeaContextSignalProvider()],
    tools: peaProductTools,
  });
  const workspace = new Workspace({
    id: "pea-workspace",
    name: "Pea Workspace",
    filesystem: new LocalFilesystem({ basePath: workspaceRoot, contained: true }),
    sandbox: new LocalSandbox({ workingDirectory: workspaceRoot, env: process.env }),
    skills: resolvePeaSkillPaths({ productHomePath }),
  });

  return createPeaRuntimeFactory<Record<string, unknown>>({
    config: {
      id: "pea",
      resourceId: createLocalResourceId("pea", workspaceRoot),
      workspace,
      modes: [
        {
          id: "agent",
          name: "Agent",
          default: true,
          defaultModelId: defaultPeaAgentModelId,
          color: "#22c55e",
          agent,
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
    },
    authStorage,
    metadata: {
      authStorageSource: authStorageContext.source,
      authStorageApiKeyProviders: Object.keys(authStorageContext.apiKeyEnvVars),
    },
  });
}

export async function createPeaTuiRuntime(
  options: PeaTuiRuntimeOptions = {},
): Promise<RuntimeHandle> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
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
  const tui = new MastraTUI({
    harness: runtime.harness,
    authStorage: runtime.authStorage as never,
    hookManager: runtime.hookManager as never,
    mcpManager: runtime.mcpManager as never,
    appName: "Pea",
    version: "0.1.0",
  });
  await tui.run();
}

export async function runPeaBetaTui(options: PeaTuiRuntimeOptions = {}): Promise<void> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const factory = await createPeaProtocolRuntimeFactory(options);
  const client = createInProcessAcpWorkbenchClient(
    (connection) => createRuntimeAcpAgent(connection, { runtime: { factory } }),
    { clientName: "Pea", clientVersion: "0.1.0" },
  );
  const { runWorkbenchTui } = await import("@pe/tui");
  await runWorkbenchTui(createPeaBetaTuiWorkbenchOptions(client, workspaceRoot));
}

export function createPeaBetaTuiWorkbenchOptions(
  client: WorkbenchAgentClient,
  cwd: string,
): PeaBetaTuiWorkbenchOptions {
  return {
    client,
    cwd,
    title: "Pea beta TUI",
    fallbackToLineMode: true,
  };
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
