import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { AgentController, AgentControllerRequestContext } from "@mastra/core/agent-controller";
import { defaultGateways, type MastraModelConfig } from "@mastra/core/llm";
import type { InputProcessor } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import { TaskSignalProvider } from "@mastra/core/signals";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import type { MastraTUIOptions } from "mastracode/tui";
import {
  createMastraCodeAuthStorageContext,
  createPeaCloudGatewayRuntimeAuthProfile,
  createPeaProductStateStorageProfile,
  createRuntimeController,
  createRuntimeMemoryProfile,
  createRuntimeMemoryOptions,
  createSystemPromptCapture,
  createToolListCapture,
  resolveRuntimeModel,
  runRuntimeAcpAgent,
  type MastraCodeAuthStorage,
  type RuntimeCreateRequest,
  type RuntimeAuthProfile,
  type RuntimeHandle,
  type RuntimeHandleServices,
  type RuntimeToolProfile,
} from "@pe/runtime";
import {
  bundledPeaSkills,
  configurePeaProductToolContext,
  defaultPeaAgentModelId,
  materializeBundledPeaSkills,
  peaProductToolProfile,
  peaProductTools,
  resolveHostBaseUrl,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolveWorkspaceKey,
} from "@pe/mcps";
import { PeaContextSignalProvider } from "./context-signals.ts";
import { peaAgentInstructions } from "./instructions.ts";

export const peaRuntimeToolProfile = peaProductToolProfile;
export const defaultPeaRuntimeToolProfile: RuntimeToolProfile = peaRuntimeToolProfile;
export const defaultPeaRuntimeToolCatalog = peaRuntimeToolProfile.catalog;

const peaAgentName = "Pea Revit Agent";
const peaAgentDescription = "High-trust Revit/operator agent for Positive Energy tooling.";

export type PeaRuntimeServices = RuntimeHandleServices & {
  authStorage: MastraCodeAuthStorage;
  hookManager: undefined;
  mcpManager: undefined;
};

export type PeaRuntimeHandle<TState extends Record<string, unknown> = Record<string, unknown>> =
  RuntimeHandle<TState, PeaRuntimeServices, AgentController<TState>>;

export type PeaRuntimeAuthSource = "gateway" | "auto" | "api-key" | "oauth" | "mastra-gateway";

export interface PeaTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  modelId?: string;
  authSource?: PeaRuntimeAuthSource;
  noCloudAuth?: boolean;
  protocol?: RuntimeCreateRequest["protocol"];
}

export async function createPeaRuntime(
  options: PeaTuiRuntimeOptions = {},
): Promise<PeaRuntimeHandle> {
  const productHomePath = resolvePeaProductHomePath();
  const workspaceRoot = path.resolve(options.workspaceRoot ?? productHomePath);
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });

  const authStorageContext = await createMastraCodeAuthStorageContext();
  const authStorage = authStorageContext.storage;
  await materializeBundledPeaSkills({ productHomePath });

  const promptCapture = createSystemPromptCapture({
    content: peaAgentInstructions,
    source: "Pea agent instructions",
  });
  // Captures the exact tool list at the model boundary so the workbench can show
  // position 0 of the request (the most cache-volatile slice). MCP tools, when a
  // runtime has them, ride along automatically — they're in the resolved list.
  const toolCapture = createToolListCapture();
  const auth = createPeaRuntimeAuthProfile({
    source: options.authSource,
    noCloudAuth: options.noCloudAuth,
  });
  const storageProfile = createPeaProductStateStorageProfile();
  const memoryProfile = createRuntimeMemoryProfile<Record<string, unknown>>({ id: "pea-memory" });
  const memoryOptions = createRuntimeMemoryOptions(undefined);
  const request = {
    protocol: options.protocol ?? "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  };

  return createRuntimeController<Record<string, unknown>, PeaRuntimeServices>({
    request,
    config: {
      id: "pea",
      resourceId: createLocalResourceId("pea", workspaceRoot),
      workspace: createPeaWorkspace({ productHomePath, workspaceRoot }),
      modes: [
        {
          id: "agent",
          name: "Agent",
          default: true,
          defaultModelId: defaultPeaAgentModelId,
          agent: createPeaAgent(promptCapture.processor, toolCapture.wrap),
        },
      ],
      gateways: defaultGateways,
      tools: peaProductTools,
      initialState: {
        currentModelId: options.modelId ?? defaultPeaAgentModelId,
        projectPath: workspaceRoot,
        productHomePath,
        configDir: ".pea",
        bundledSkillCount: bundledPeaSkills.length,
        yolo: true,
      },
    },
    auth,
    authStorage,
    storageProfile,
    memoryProfile,
    toolProfile: peaRuntimeToolProfile,
    workspace: { cwd: workspaceRoot, root: workspaceRoot },
    metadata: {
      runtimeId: "pea",
      storageProfileId: storageProfile.id,
      memoryProfileId: memoryProfile.id,
      toolProfileId: peaRuntimeToolProfile.id,
      protocol: request.protocol,
      cwd: workspaceRoot,
      workspaceRoot,
      authSource: auth.descriptor.source,
      noCloudAuth: auth.descriptor.source === "api-key",
      authStorageSource: authStorageContext.source,
      authStorageApiKeyProviders: Object.keys(authStorageContext.apiKeyEnvVars),
      workbench: {
        systemPrompt: promptCapture.snapshot,
        toolList: toolCapture.snapshot,
        contextWindow: 200_000,
        agents: [{ name: peaAgentName, description: peaAgentDescription }],
        availableModels: [
          { id: defaultPeaAgentModelId, displayName: "GPT-5.4", provider: "openai" },
          {
            id: "anthropic/claude-opus-4-8",
            displayName: "Claude Opus 4.8",
            provider: "anthropic",
          },
          {
            id: "anthropic/claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            provider: "anthropic",
          },
        ],
        skills: bundledPeaSkills.map((skill) => ({
          name: skill.name,
          description: peaSkillDescription(skill.content),
          // Full markdown so the World inspector can expand the skill card.
          // ponytail: re-serialized on every state emit; move to a one-time payload if
          // the SSE state size ever bites.
          content: skill.content,
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
}

/** Pull the one-line `description:` from a bundled skill's frontmatter for the command menu. */
function peaSkillDescription(content: string): string | undefined {
  const match = /^description:\s*(.+)$/m.exec(content);
  return match?.[1]?.trim();
}

function createPeaAgent(
  captureProcessor?: InputProcessor,
  wrapModel?: (model: MastraModelConfig) => MastraModelConfig,
): Agent {
  return new Agent({
    id: "pea-agent",
    name: peaAgentName,
    description: peaAgentDescription,
    instructions: peaAgentInstructions,
    model: async ({ requestContext }) => {
      const model = await resolveCurrentModel(requestContext, defaultPeaAgentModelId);
      return wrapModel ? wrapModel(model) : model;
    },
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
  return createPeaRuntime(options);
}

export async function runPeaTui(options: PeaTuiRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaTuiRuntime(options);
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  const { MastraTUI } = await import("mastracode/tui");
  const tuiOptions: MastraTUIOptions = {
    controller: runtime.controller,
    session: runtime.session,
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    appName: "Pea",
    version: "0.1.0",
  };
  const tui = new MastraTUI(tuiOptions);
  await tui.run();
}

export async function runPeaAcp(options: PeaTuiRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime({ ...options, protocol: "acp" });
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  await runRuntimeAcpAgent({
    controller: runtime.controller,
    session: runtime.session,
    modes: runtime.controller.listModes(),
    cleanup: () => runtime.close?.(),
  });
}

export function createPeaRuntimeAuthProfile(
  options: {
    source?: PeaRuntimeAuthSource;
    noCloudAuth?: boolean;
    allowOauthBetaAuth?: boolean;
    logout?: () => Promise<void>;
  } = {},
): RuntimeAuthProfile {
  const { noCloudAuth, ...profileOptions } = options;
  const source = noCloudAuth === true ? "api-key" : profileOptions.source;
  return createPeaCloudGatewayRuntimeAuthProfile({
    ...profileOptions,
    source,
    apiKeyDescription:
      source === "api-key"
        ? "Use local OPENAI_API_KEY or stored API-key credentials for Pea model access."
        : "Use OPENAI_API_KEY only as a local Pea model-access escape hatch.",
  });
}

function resolveCurrentModel(
  requestContext: RequestContext,
  fallbackModelId: string,
): Promise<MastraModelConfig> {
  const controller = requestContext.get("controller") as
    | AgentControllerRequestContext<{ currentModelId?: string }>
    | undefined;
  // session.modelId is the live selection ('' when none); getState().currentModelId is the
  // initial/stored value. Prefer the selection, then stored, then the hard default.
  const modelId =
    controller?.session.modelId || controller?.getState().currentModelId || fallbackModelId;
  return resolveRuntimeModel(modelId, requestContext);
}

function createLocalResourceId(runtimeId: string, cwd: string): string {
  return `${runtimeId}:${Buffer.from(cwd).toString("base64url")}`;
}
