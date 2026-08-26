import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Agent } from "@mastra/core/agent";
import type {
  AgentController,
  AgentControllerRequestContext,
  AvailableModel,
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
import { stateSchema } from "@mastra/code-sdk/schema";
import {
  bundledPeaSkills,
  configurePeaProductToolContext,
  materializeBundledPeaSkills,
  peaProductToolMetadata,
  peaProductTools,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolveWorkspaceKey,
} from "@pe/mcps";
import { z } from "zod";
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

const defaultPeaAgentModelId = "openai/gpt-5.6-terra";

const peaAgentName = "Pea Revit Agent";
const peaAgentDescription = "High-trust Revit/operator agent for Positive Energy tooling.";
const permissionSettingKey = "pea.permissions";
const permissionCategories: ToolCategory[] = ["read", "edit", "execute", "mcp", "other"];
const permissionPolicies = {
  "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
  ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
  trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
} as const satisfies Record<RuntimeAccessLevel, Record<ToolCategory, "allow" | "ask" | "deny">>;
const codePermissionRulesSchema = stateSchema.shape.permissionRules.unwrap();
const permissionRecordSchema = z
  .object({
    yolo: z.literal(false),
    permissionRules: codePermissionRulesSchema
      .extend({
        categories: codePermissionRulesSchema.shape.categories.unwrap(),
        tools: codePermissionRulesSchema.shape.tools.unwrap(),
      })
      .strict(),
  })
  .strict();

type PermissionRecord = z.infer<typeof permissionRecordSchema>;
type RuntimeAccessLevel = NonNullable<PeaRuntimeOptions["accessLevel"]>;

type PeaRuntimeState = Record<string, unknown> & {
  permissionRules?: unknown;
  yolo?: boolean;
};

type PeaAuthStorage = ReturnType<typeof createAuthStorage>;

type PeaRuntimeServices = RuntimeHandleServices & {
  authStorage: PeaAuthStorage;
};

export type PeaRuntimeHandle = RuntimeHandle<
  PeaRuntimeState,
  PeaRuntimeServices,
  AgentController<PeaRuntimeState>
>;

export interface PeaRuntimeOptions {
  workspaceRoot?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  modelId?: string;
  accessLevel?: "read-only" | "ask" | "trusted";
  protocol?: RuntimeCreateRequest["protocol"];
}

export async function createPeaRuntime(options: PeaRuntimeOptions = {}): Promise<PeaRuntimeHandle> {
  const productHomePath = resolvePeaProductHomePath();
  const workspaceRoot = path.resolve(options.workspaceRoot ?? productHomePath);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl: options.hostBaseUrl, workspaceKey });

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
      resourceId: `pea:${Buffer.from(workspaceRoot).toString("base64url")}`,
      workspace: new Workspace({
        id: "pea-workspace",
        name: "Pea Workspace",
        filesystem: new LocalFilesystem({ basePath: workspaceRoot, contained: true }),
        sandbox: new LocalSandbox({ workingDirectory: workspaceRoot }),
        skills: resolvePeaSkillPaths({ productHomePath }),
      }),
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
          description: /^description:\s*(.+)$/m.exec(skill.content)?.[1]?.trim(),
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
  const modelId = context?.session.modelId || defaultPeaAgentModelId;
  const model = (await listAvailableModels()).find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown Pea model '${modelId}'.`);
  if (!model.hasApiKey) throw new Error(`Pea model '${modelId}' has no available credentials.`);
  return resolveModel(modelId, { requestContext });
}

function resolvePeaToolCategory(toolName: string): ToolCategory {
  if (Object.hasOwn(peaProductToolMetadata, toolName)) {
    return peaProductToolMetadata[toolName as keyof typeof peaProductToolMetadata].category;
  }

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
  const stored = await session.thread.getSetting({ key: permissionSettingKey });
  const persisted = readPermissionRecord(stored);
  const persistedLevel = persisted
    ? accessLevelFromPermissionRules(persisted.permissionRules)
    : undefined;
  const level =
    stored === undefined
      ? (requestedAccessLevel ?? "ask")
      : persistedLevel
        ? (requestedAccessLevel ?? persistedLevel)
        : "read-only";
  const effective = permissionRulesForAccessLevel(level ?? "read-only");
  if (persisted && persistedLevel) effective.tools = { ...persisted.permissionRules.tools };

  const record = permissionRecordSchema.parse({ yolo: false, permissionRules: effective });
  await session.thread.setSetting({ key: permissionSettingKey, value: record });
  await session.state.set({ yolo: false, permissionRules: record.permissionRules });
  if (
    session.state.get().yolo !== false ||
    !isDeepStrictEqual(await session.thread.getSetting({ key: permissionSettingKey }), record) ||
    !isDeepStrictEqual(session.permissions.getRules(), record.permissionRules)
  ) {
    throw new Error("Pea permission state did not persist exactly.");
  }
}

function permissionRulesForAccessLevel(level: RuntimeAccessLevel): PermissionRules {
  return { categories: { ...permissionPolicies[level] }, tools: {} };
}

function accessLevelFromPermissionRules(rules: PermissionRules): RuntimeAccessLevel | undefined {
  if (Object.keys(rules.categories).length !== permissionCategories.length) return undefined;
  return (Object.keys(permissionPolicies) as RuntimeAccessLevel[]).find((level) =>
    permissionCategories.every(
      (category) => rules.categories[category] === permissionPolicies[level][category],
    ),
  );
}

function readPermissionRecord(value: unknown): PermissionRecord | undefined {
  const parsed = permissionRecordSchema.safeParse(value);
  if (!parsed.success || !accessLevelFromPermissionRules(parsed.data.permissionRules)) {
    return undefined;
  }
  return parsed.data;
}
