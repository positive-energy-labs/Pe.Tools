import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type {
  AgentController,
  AgentControllerRequestContext,
  AvailableModel,
  PermissionPolicy,
  PermissionRules,
  ToolCategory,
} from "@mastra/core/agent-controller";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { InputProcessor } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import { TaskSignalProvider } from "@mastra/core/signals";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { createAuthStorage } from "@mastra/code-sdk";
import { createMastraCodeGateway, resolveModel } from "@mastra/code-sdk/agents/model";
import { getToolCategory, getToolsForCategory } from "@mastra/code-sdk/permissions";
import {
  accessLevelFromPermissionRules,
  assertRuntimeToolCatalogMatchesTools,
  permissionRulesForAccessLevel,
  type RuntimeAccessLevel,
  type RuntimeToolKind,
} from "@pe/agent-contracts";
import {
  bundledPeaSkills,
  configurePeaProductToolContext,
  materializeBundledPeaSkills,
  peaProductToolCatalog,
  peaProductTools,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolveWorkspaceKey,
} from "@pe/mcps";
import { createRuntimeController } from "./controller/create-runtime-controller.ts";
import { createRuntimeMemoryOptions, createRuntimeMemoryProfile } from "./memory/profiles.ts";
import type { RuntimeCreateRequest, RuntimeHandle, RuntimeHandleServices } from "./runtime.ts";
import { createPeaProductStateStorageProfile } from "./storage/profiles.ts";
import { createSystemPromptCapture } from "./system-prompt-capture.ts";
import { createToolListCapture } from "./tool-list-capture.ts";
import { PeaContextSignalProvider } from "./pea-context-signals.ts";
import { peaAgentInstructions } from "./pea-instructions.ts";

export { peaAgentInstructions } from "./pea-instructions.ts";
export * from "./pea-context-signals.ts";

export const defaultPeaAgentModelId = "openai/gpt-5.6-terra";

const peaAgentName = "Pea Revit Agent";
const peaAgentDescription = "High-trust Revit/operator agent for Positive Energy tooling.";
const toolCategories: ToolCategory[] = ["read", "edit", "execute", "mcp", "other"];
const permissionPolicies = new Set<PermissionPolicy>(["allow", "ask", "deny"]);
const toolKindToCategory: Record<RuntimeToolKind, ToolCategory> = {
  read: "read",
  search: "read",
  fetch: "read",
  think: "read",
  edit: "edit",
  delete: "edit",
  execute: "execute",
  other: "other",
};

type PeaAuthStorage = ReturnType<typeof createAuthStorage>;
type PeaRuntimeState = Record<string, unknown> & {
  currentModelId?: string;
  permissionRules?: unknown;
  yolo?: boolean;
};

export type PeaRuntimeServices = RuntimeHandleServices & {
  authStorage: PeaAuthStorage;
  hookManager: undefined;
  mcpManager: undefined;
};

export type PeaRuntimeHandle = RuntimeHandle<
  PeaRuntimeState,
  PeaRuntimeServices,
  AgentController<PeaRuntimeState>
>;

export interface PeaTuiRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  modelId?: string;
  accessLevel?: RuntimeAccessLevel;
  protocol?: RuntimeCreateRequest["protocol"];
}

export async function createPeaRuntime(
  options: PeaTuiRuntimeOptions = {},
): Promise<PeaRuntimeHandle> {
  const productHomePath = resolvePeaProductHomePath();
  const workspaceRoot = path.resolve(options.workspaceRoot ?? productHomePath);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl: options.hostBaseUrl, workspaceKey });
  assertRuntimeToolCatalogMatchesTools(peaProductTools, peaProductToolCatalog);

  const authStorage = createAuthStorage();
  const gateway = createMastraCodeGateway({
    mastraGatewayBaseUrl: (process.env.MASTRA_GATEWAY_URL ?? "https://gateway-api.mastra.ai")
      .replace(/\/+$/, "")
      .replace(/\/v1$/, ""),
    mastraGatewayApiKey: process.env.MASTRA_GATEWAY_API_KEY,
    routeThroughMastraGateway: false,
    credentialStore: authStorage,
  });
  await materializeBundledPeaSkills({ productHomePath });

  const promptCapture = createSystemPromptCapture({
    content: peaAgentInstructions,
    source: "Pea agent instructions",
  });
  const toolCapture = createToolListCapture();
  const storageProfile = createPeaProductStateStorageProfile();
  const memoryProfile = createRuntimeMemoryProfile<PeaRuntimeState>({ id: "pea-memory" });
  const memoryOptions = createRuntimeMemoryOptions(undefined);
  const request = {
    protocol: options.protocol ?? "tui",
    cwd: workspaceRoot,
    workspaceRoot,
  };
  let controller: AgentController<PeaRuntimeState> | undefined;

  const handle = await createRuntimeController<PeaRuntimeState, PeaRuntimeServices>({
    request,
    config: {
      id: "pea",
      resourceId: createLocalResourceId("pea", workspaceRoot),
      workspace: createPeaWorkspace({ productHomePath, workspaceRoot }),
      agent: createPeaAgent(
        promptCapture.processor,
        toolCapture.wrap,
        () => controller?.listAvailableModels() ?? Promise.resolve([]),
      ),
      modes: [{ id: "agent", name: "Agent", defaultModelId: defaultPeaAgentModelId }],
      defaultModeId: "agent",
      gateways: [gateway],
      tools: peaProductTools,
      toolCategoryResolver: resolvePeaToolCategory,
      initialState: {
        currentModelId: options.modelId ?? defaultPeaAgentModelId,
        projectPath: workspaceRoot,
        productHomePath,
        configDir: ".pea",
        bundledSkillCount: bundledPeaSkills.length,
        thinkingLevel: "high",
      },
    },
    authStorage,
    storageProfile,
    memoryProfile,
    workspace: { cwd: workspaceRoot, root: workspaceRoot },
    metadata: {
      runtimeId: "pea",
      storageProfileId: storageProfile.id,
      memoryProfileId: memoryProfile.id,
      protocol: request.protocol,
      cwd: workspaceRoot,
      workspaceRoot,
      workbench: {
        systemPrompt: promptCapture.snapshot,
        toolList: toolCapture.snapshot,
        contextWindow: 200_000,
        agents: [{ name: peaAgentName, description: peaAgentDescription }],
        skills: bundledPeaSkills.map((skill) => ({
          name: skill.name,
          description: peaSkillDescription(skill.content),
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
  controller = handle.controller;

  try {
    await configurePermissions(handle, options.accessLevel);
  } catch (error) {
    await handle.close?.();
    throw error;
  }
  return handle;
}

function createPeaAgent(
  captureProcessor: InputProcessor | undefined,
  wrapModel: ((model: MastraModelConfig) => MastraModelConfig) | undefined,
  listAvailableModels: () => Promise<AvailableModel[]>,
): Agent {
  return new Agent({
    id: "pea-agent",
    name: peaAgentName,
    description: peaAgentDescription,
    instructions: peaAgentInstructions,
    model: async ({ requestContext }) => {
      const model = await resolveCurrentModel(requestContext, listAvailableModels);
      return wrapModel ? wrapModel(model) : model;
    },
    signals: [new TaskSignalProvider(), new PeaContextSignalProvider()],
    tools: peaProductTools,
    inputProcessors: captureProcessor ? [captureProcessor] : undefined,
  });
}

async function resolveCurrentModel(
  requestContext: RequestContext,
  listAvailableModels: () => Promise<AvailableModel[]>,
): Promise<MastraModelConfig> {
  const context = requestContext.get("controller") as
    | AgentControllerRequestContext<PeaRuntimeState>
    | undefined;
  const modelId =
    context?.session.modelId || context?.getState().currentModelId || defaultPeaAgentModelId;
  const model = (await listAvailableModels()).find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown Pea model '${modelId}'.`);
  if (!model.hasApiKey) throw new Error(`Pea model '${modelId}' has no available credentials.`);
  return resolveModel(modelId, { requestContext });
}

function resolvePeaToolCategory(toolName: string): ToolCategory {
  const kind = peaProductToolCatalog.get(toolName)?.kind;
  if (kind) return toolKindToCategory[kind];

  const codeCategory = getToolCategory(toolName);
  if (codeCategory === null) return "read";
  return getToolsForCategory(codeCategory).includes(toolName) ? codeCategory : "other";
}

async function configurePermissions(
  handle: PeaRuntimeHandle,
  requestedAccessLevel: RuntimeAccessLevel | undefined,
): Promise<void> {
  const session = handle.session;
  if (!session) throw new Error("Expected Pea runtime session.");
  const state = session.state.get();
  const persisted = readPermissionRules(state.permissionRules);
  const persistedLevel =
    persisted && state.yolo === false
      ? accessLevelFromPermissionRules(persisted, state.yolo)
      : undefined;
  const level =
    requestedAccessLevel ?? (state.permissionRules === undefined ? "ask" : persistedLevel);
  const effective = permissionRulesForAccessLevel(level ?? "read-only");
  if (persisted && level) effective.tools = { ...persisted.tools };

  await session.state.set({ yolo: false, permissionRules: effective });
  if (
    session.state.get().yolo !== false ||
    !permissionRulesEqual(session.permissions.getRules(), effective)
  ) {
    throw new Error("Pea permission state did not persist exactly.");
  }
}

function readPermissionRules(value: unknown): PermissionRules | undefined {
  if (!isRecord(value) || !isRecord(value.categories) || !isRecord(value.tools)) return undefined;
  const categoryEntries = Object.entries(value.categories);
  const toolEntries = Object.entries(value.tools);
  if (
    categoryEntries.some(
      ([category, policy]) =>
        !toolCategories.includes(category as ToolCategory) ||
        !permissionPolicies.has(policy as PermissionPolicy),
    ) ||
    toolEntries.some(([, policy]) => !permissionPolicies.has(policy as PermissionPolicy))
  ) {
    return undefined;
  }
  return {
    categories: Object.fromEntries(categoryEntries) as PermissionRules["categories"],
    tools: Object.fromEntries(toolEntries) as PermissionRules["tools"],
  };
}

function permissionRulesEqual(left: PermissionRules, right: PermissionRules): boolean {
  return (
    toolCategories.every((category) => left.categories[category] === right.categories[category]) &&
    JSON.stringify(
      Object.entries(left.tools).sort(([leftName], [rightName]) =>
        leftName.localeCompare(rightName),
      ),
    ) ===
      JSON.stringify(
        Object.entries(right.tools).sort(([leftName], [rightName]) =>
          leftName.localeCompare(rightName),
        ),
      )
  );
}

function createPeaWorkspace(options: {
  productHomePath: string;
  workspaceRoot: string;
}): Workspace {
  return new Workspace({
    id: "pea-workspace",
    name: "Pea Workspace",
    filesystem: new LocalFilesystem({ basePath: options.workspaceRoot, contained: true }),
    sandbox: new LocalSandbox({ workingDirectory: options.workspaceRoot }),
    skills: resolvePeaSkillPaths({ productHomePath: options.productHomePath }),
  });
}

function peaSkillDescription(content: string): string | undefined {
  return /^description:\s*(.+)$/m.exec(content)?.[1]?.trim();
}

function createLocalResourceId(runtimeId: string, cwd: string): string {
  return `${runtimeId}:${Buffer.from(cwd).toString("base64url")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
