import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Agent, createSignal, type AgentSignalInput } from "@mastra/core/agent";
export { readThreadState } from "./thread-state.ts";
import type {
  AgentController,
  AgentControllerRequestContext,
  AvailableModel,
  PermissionRules,
  Session,
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
import {
  threadAccess,
  threadAccessPolicies,
  turnScopeContextKey,
  turnScopeSchema,
  type PeaWorldDescriptor,
} from "@pe/agent-contracts";
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

/** The whole model world Pea offers, in display order. Edit this list to change the picker. */
export const peaModelAllowlist = [
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6",
  "anthropic/claude-fable-5",
  "anthropic/claude-opus-5",
];

/** Narrow the gateway catalog (models.dev, ~13k ids) to the allowlist, allowlist order. */
export function peaModels(catalog: AvailableModel[]): AvailableModel[] {
  return peaModelAllowlist.flatMap((id) => catalog.find((model) => model.id === id) ?? []);
}

const peaAgentName = "Pea Revit Agent";
const peaAgentDescription = "High-trust Revit/operator agent for Positive Energy tooling.";
const permissionSettingKey = "pea.permissions";
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
> & {
  resourceId: string;
  capabilities: Readonly<PeaRuntimeCapabilities>;
  world: PeaWorldDescriptor;
  isSessionAdmitted(session: Session<PeaRuntimeState>): boolean;
};

export interface PeaRuntimeOptions {
  workspaceRoot?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  modelId?: string;
  accessLevel?: "read-only" | "ask" | "trusted";
  capabilities?: PeaRuntimeCapabilities;
  protocol?: RuntimeCreateRequest["protocol"];
}

export interface PeaRuntimeCapabilities {
  readonly revit: boolean;
}

export function resolvePeaWorld(workspaceRoot = resolvePeaProductHomePath()) {
  const root = path.resolve(workspaceRoot);
  return {
    id: `pea:${Buffer.from(root).toString("base64url")}`,
    root,
    storage: { kind: "local-unversioned" },
    isolation: "none",
  } as const satisfies PeaWorldDescriptor;
}

export async function createPeaRuntime(options: PeaRuntimeOptions = {}): Promise<PeaRuntimeHandle> {
  const productHomePath = resolvePeaProductHomePath();
  const world = resolvePeaWorld(options.workspaceRoot ?? productHomePath);
  const workspaceRoot = world.root;
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  const capabilities = Object.freeze({ revit: options.capabilities?.revit ?? false });
  const productTools = selectPeaProductTools(capabilities);
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
  const resourceId = world.id;
  let controller: AgentController<PeaRuntimeState> | undefined;
  let policy: PeaControllerPolicy | undefined;

  const handle = await createRuntimeController<PeaRuntimeState, PeaRuntimeServices>({
    request,
    configureController: (built) => {
      controller = built;
      // One seam: snapshot, switchModel, and agent model resolution all read this method.
      const nativeList = built.listAvailableModels.bind(built);
      built.listAvailableModels = async () => peaModels(await nativeList());
      policy = installPeaControllerPolicy(built, {
        accessLevel: options.accessLevel,
        resourceId,
        scopedWeb: request.protocol === "web",
      });
      return policy.close;
    },
    config: {
      id: "pea",
      resourceId,
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
        productTools,
      ),
      modes: [{ id: "agent", name: "Agent", defaultModelId: defaultPeaAgentModelId }],
      defaultModeId: "agent",
      gateways: [gateway],
      tools: productTools,
      toolCategoryResolver: resolvePeaToolCategory,
      initialState: {
        currentModelId: options.modelId ?? defaultPeaAgentModelId,
        projectPath: workspaceRoot,
        productHomePath,
        configDir: ".pea",
        bundledSkillCount: bundledPeaSkills.length,
        thinkingLevel: "high",
        yolo: false,
        permissionRules: permissionRulesForAccessLevel("read-only"),
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
  if (!policy) throw new Error("Pea controller policy was not installed.");
  try {
    if (handle.session) await policy.requireAdmitted(handle.session);
  } catch (error) {
    await handle.close?.();
    throw error;
  }
  return Object.assign(handle, {
    resourceId: world.id,
    capabilities,
    world,
    isSessionAdmitted: (session: Session<PeaRuntimeState>) => policy!.isAdmitted(session),
  });
}

interface PeaControllerPolicy {
  isAdmitted(session: Session<PeaRuntimeState>): boolean;
  requireAdmitted(session: Session<PeaRuntimeState>): Promise<void>;
  close(): Promise<void>;
}

interface PeaSessionAdmission {
  ready: Promise<void>;
  isAdmitted(): boolean;
  close(): Promise<void>;
}

function readContextKey(context: unknown, key: string): unknown {
  if (!context || typeof context !== "object") return undefined;
  const get = (context as { get?: (key: string) => unknown }).get;
  return typeof get === "function"
    ? get.call(context, key)
    : (context as Record<string, unknown>)[key];
}

type MessageFile = { data: string; mediaType: string; filename?: string };

/** Mirrors core `Session.createMessageInput` (private there): text and JSON files inline as fenced text. */
export function messageContents(content: string, files: MessageFile[] | undefined) {
  if (!files?.length) return content;
  const fileParts = files.map((file) => {
    if (file.mediaType.startsWith("text/") || file.mediaType === "application/json") {
      const base64 = /^data:[^;]*;base64,(.*)$/.exec(file.data)?.[1];
      const text = base64 ? Buffer.from(base64, "base64").toString("utf-8") : file.data;
      const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const label = file.filename ? `[File: ${file.filename}]` : "[Attached file]";
      return {
        type: "text" as const,
        text: `${label}
${fence}
${text}
${fence}`,
      };
    }
    return {
      type: "file" as const,
      data: file.data,
      mediaType: file.mediaType,
      ...(file.filename ? { filename: file.filename } : {}),
    };
  });
  return content ? [{ type: "text" as const, text: content }, ...fileParts] : fileParts;
}

function installPeaControllerPolicy(
  controller: AgentController<PeaRuntimeState>,
  options: {
    accessLevel?: RuntimeAccessLevel;
    resourceId: string;
    scopedWeb: boolean;
  },
): PeaControllerPolicy {
  const admissions = new Map<Session<PeaRuntimeState>, PeaSessionAdmission>();
  const createSession = controller.createSession.bind(controller);
  const unsubscribeCreated = controller.onSessionCreated(
    async (session) => {
      let admission = admissions.get(session);
      if (!admission) {
        admission = createPeaSessionAdmission(
          controller,
          session,
          options.accessLevel,
          options.scopedWeb ? session.thread.requireId() : undefined,
        );
        admissions.set(session, admission);
      }
      await admission.ready;
    },
    { blocking: true },
  );
  const unsubscribeDeleted = controller.onSessionDeleted((session) => {
    const admission = admissions.get(session);
    admissions.delete(session);
    void admission?.close();
  });

  if (options.scopedWeb) {
    controller.createSession = (async (input = {}) => {
      const resourceId = input.resourceId ?? options.resourceId;
      const scope = input.scope?.trim();
      const threadId = input.threadId?.trim() ?? scope;
      if (resourceId !== options.resourceId) throw new Error("Pea web resourceId is immutable.");
      if (!scope) throw new Error("Pea web sessions require a scope.");
      if (threadId !== scope) {
        throw new Error("Pea web session scope must equal threadId.");
      }

      const admitted = await controller.getSessionByResource(resourceId, scope);
      const session = await createSession({ ...input, resourceId, scope, threadId });
      const admission = admissions.get(session);
      if (!admission) throw new Error("Pea session was not admitted.");
      await admission.ready;
      if (!admission.isAdmitted() || session.thread.getId() !== scope) {
        throw new Error("Pea scoped session admission failed.");
      }
      if (admitted && admitted !== session)
        throw new Error("Pea web scope resolved another session.");
      return session;
    }) as typeof controller.createSession;
  }

  return {
    isAdmitted: (session) => admissions.get(session)?.isAdmitted() === true,
    requireAdmitted: async (session) => {
      const admission = admissions.get(session);
      if (!admission) throw new Error("Pea session was not admitted.");
      await admission.ready;
      if (!admission.isAdmitted()) throw new Error("Pea session admission failed.");
    },
    close: async () => {
      unsubscribeCreated();
      unsubscribeDeleted();
      controller.createSession = createSession;
      await Promise.all([...admissions.values()].map((admission) => admission.close()));
      admissions.clear();
    },
  };
}

function createPeaSessionAdmission(
  controller: AgentController<PeaRuntimeState>,
  session: Session<PeaRuntimeState>,
  requestedAccessLevel: RuntimeAccessLevel | undefined,
  scopedThreadId: string | undefined,
): PeaSessionAdmission {
  let permissionThreadId = session.thread.requireId();
  let permissionGeneration = 0;
  let permissionQueue = Promise.resolve();
  let permissionHydration = permissionQueue;
  let unsubscribePermissions: (() => void) | undefined;
  let restoreScopedThreadLifecycle: (() => void) | undefined;
  let admitted = false;
  let closed = false;

  const assertCurrent = (threadId: string, generation: number) => {
    if (closed || session.thread.getId() !== threadId || permissionGeneration !== generation) {
      throw new Error("Pea permission thread changed during hydration.");
    }
  };
  const hydratePermissions = (threadId: string, accessLevel?: RuntimeAccessLevel) => {
    const generation = ++permissionGeneration;
    permissionThreadId = threadId;
    const storedPermission = session.thread.getSetting({ key: permissionSettingKey });
    void storedPermission.catch(() => {});
    permissionHydration = permissionQueue.then(() =>
      configurePermissions(session, accessLevel, storedPermission, () =>
        assertCurrent(threadId, generation),
      ),
    );
    permissionQueue = permissionHydration.catch(() => {});
    void permissionHydration.catch(() => {});
  };
  const awaitPermissions = async (followCurrent = false) => {
    while (true) {
      const threadId = session.thread.requireId();
      if (permissionThreadId !== threadId) hydratePermissions(threadId);
      const generation = permissionGeneration;
      const hydration = permissionHydration;
      try {
        await hydration;
      } catch (error) {
        if (
          !followCurrent ||
          (session.thread.getId() === threadId && generation === permissionGeneration)
        )
          throw error;
        continue;
      }
      if (session.thread.getId() === threadId && generation === permissionGeneration) return;
      if (!followCurrent) throw new Error("Pea permission thread changed during hydration.");
    }
  };
  const setForCategory = session.permissions.setForCategory.bind(session.permissions);
  const setForTool = session.permissions.setForTool.bind(session.permissions);
  const persistPermissionMutation = (mutation: () => Promise<void>) => {
    const threadId = session.thread.requireId();
    const generation = permissionGeneration;
    const persisted = permissionQueue.then(async () => {
      assertCurrent(threadId, generation);
      await mutation();
      assertCurrent(threadId, generation);
      const record = permissionRecordSchema.parse({
        yolo: false,
        permissionRules: session.permissions.getRules(),
      });
      await session.thread.setSetting({ key: permissionSettingKey, value: record });
      assertCurrent(threadId, generation);
      await session.state.set({ yolo: false, permissionRules: record.permissionRules });
      assertCurrent(threadId, generation);
      const durable = await session.thread.getSetting({ key: permissionSettingKey });
      assertCurrent(threadId, generation);
      if (
        !isDeepStrictEqual(durable, record) ||
        session.state.get().yolo !== false ||
        !isDeepStrictEqual(session.permissions.getRules(), record.permissionRules)
      ) {
        throw new Error("Pea permission state did not persist exactly.");
      }
    });
    permissionQueue = persisted.catch(() => {});
    return persisted;
  };
  session.permissions.setForCategory = (input) =>
    persistPermissionMutation(() => setForCategory(input));
  session.permissions.setForTool = (input) => persistPermissionMutation(() => setForTool(input));
  const assertRunAdmitted = async () => {
    await awaitPermissions();
    await permissionQueue;
    if (!admitted || closed) throw new Error("Pea session has not completed permission admission.");
    const threadId = session.thread.requireId();
    const generation = permissionGeneration;
    const durable = readPermissionRecord(
      await session.thread.getSetting({ key: permissionSettingKey }),
    );
    if (
      session.thread.getId() !== threadId ||
      permissionGeneration !== generation ||
      !durable ||
      session.state.get().yolo !== false ||
      !isDeepStrictEqual(session.permissions.getRules(), durable.permissionRules)
    ) {
      throw new Error("Pea permission state did not persist exactly.");
    }
  };

  const sendSignal = session.sendSignal.bind(session) as typeof session.sendSignal;
  session.sendSignal = ((input, options) => {
    const admission = [session.thread.requireId(), permissionGeneration] as const;
    const contentOptions = "content" in input ? input : undefined;
    const signal = createSignal(
      contentOptions
        ? {
            type: "user",
            tagName: "user",
            contents: contentOptions.content,
            providerOptions: contentOptions.providerOptions,
          }
        : (input as AgentSignalInput),
    );
    return {
      id: signal.id,
      type: signal.type,
      accepted: assertRunAdmitted().then(() =>
        session.thread.getId() !== admission[0] || permissionGeneration !== admission[1]
          ? Promise.reject(new Error("Pea permission thread changed during hydration."))
          : sendSignal(input, options).accepted,
      ),
    };
  }) as typeof session.sendSignal;

  // The turn scope is parsed once at admission, frozen for every tool call, and persisted on the
  // user signal.
  // This resolves at admission, not completion; the reply arrives on the session stream.
  session.sendMessage = async ({ content, files, requestContext }) => {
    await assertRunAdmitted();
    const parsedScope = turnScopeSchema.safeParse(
      readContextKey(requestContext, turnScopeContextKey),
    );
    if (scopedThreadId && !parsedScope.success)
      throw new Error("Pea web turns require a valid scope.");
    const scope = parsedScope.success ? Object.freeze(parsedScope.data) : undefined;
    const setter = (requestContext as { set?: (key: string, value: unknown) => void } | undefined)
      ?.set;
    if (scope && setter) setter.call(requestContext, turnScopeContextKey, scope);
    const signal = session.sendSignal(
      {
        type: "user",
        tagName: "user",
        contents: messageContents(content, files),
        ...(scope ? { id: scope.id, metadata: { scope } } : {}),
      },
      { requestContext },
    );
    await signal.accepted;
  };
  const steer = session.steer.bind(session);
  session.steer = async (input) => {
    await assertRunAdmitted();
    return steer(input);
  };
  const followUp = session.followUp.bind(session);
  session.followUp = async (input) => {
    await assertRunAdmitted();
    return followUp(input);
  };
  const drainFollowUpQueue = session.drainFollowUpQueue.bind(session);
  session.drainFollowUpQueue = async (options) => {
    await assertRunAdmitted();
    return drainFollowUpQueue(options);
  };
  const sendNotificationSignal = session.sendNotificationSignal.bind(session);
  session.sendNotificationSignal = async (input, options) => {
    if (scopedThreadId) throw new Error("Pea web sessions do not support notifications.");
    await assertRunAdmitted();
    return sendNotificationSignal(input, options);
  };
  const respondToToolSuspension = session.respondToToolSuspension.bind(session);
  session.respondToToolSuspension = async (input) => {
    await assertRunAdmitted();
    return respondToToolSuspension(input);
  };
  const approveToolCall = session.approveToolCall.bind(session);
  session.approveToolCall = async (input) => {
    await assertRunAdmitted();
    return approveToolCall(input);
  };
  const declineToolCall = session.declineToolCall.bind(session);
  session.declineToolCall = async (input) => {
    await assertRunAdmitted();
    return declineToolCall(input);
  };

  if (scopedThreadId) {
    const immutable = () => {
      throw new Error(`Pea web session '${scopedThreadId}' has an immutable thread binding.`);
    };
    const setThread = session.thread.set.bind(session.thread);
    session.thread.set = () => immutable();
    restoreScopedThreadLifecycle = () => {
      session.thread.set = setThread;
    };
    session.thread.switch = async () => immutable();
    session.thread.create = async () => immutable();
    session.thread.clone = async () => immutable();
    session.thread.cloneToCurrentResource = async () => immutable();
    session.identity.setResourceId = () => immutable();
  } else {
    const switchThread = session.thread.switch.bind(session.thread);
    session.thread.switch = async (input) => {
      permissionGeneration++;
      await switchThread(input);
      await awaitPermissions(true);
    };
  }

  const ready = (async () => {
    hydratePermissions(permissionThreadId, requestedAccessLevel);
    await permissionHydration;
    unsubscribePermissions = session.subscribe((event) => {
      if (event.type === "thread_changed") hydratePermissions(event.threadId);
      if (event.type === "thread_created") hydratePermissions(event.thread.id);
    });
    admitted = true;
  })();

  return {
    ready,
    isAdmitted: () => admitted && !closed,
    close: async () => {
      if (!closed) {
        closed = true;
        admitted = false;
        permissionGeneration++;
        unsubscribePermissions?.();
        restoreScopedThreadLifecycle?.();
      }
      await permissionQueue;
    },
  };
}

function createPeaAgent(
  captureProcessor: InputProcessor | undefined,
  wrapModel: ((model: MastraModelConfig) => MastraModelConfig) | undefined,
  listAvailableModels: () => Promise<AvailableModel[]>,
  tools: Partial<typeof peaProductTools>,
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
    tools,
    inputProcessors: captureProcessor ? [captureProcessor] : undefined,
  });
}

function selectPeaProductTools(
  capabilities: PeaRuntimeCapabilities,
): Partial<typeof peaProductTools> {
  if (capabilities.revit) return peaProductTools;
  return Object.fromEntries(
    Object.entries(peaProductTools).filter(
      ([name]) =>
        !peaProductToolMetadata[name as keyof typeof peaProductToolMetadata].requiresRevit,
    ),
  );
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
  session: Session<PeaRuntimeState>,
  requestedAccessLevel: RuntimeAccessLevel | undefined,
  storedPermission: Promise<unknown>,
  assertCurrent: () => void,
): Promise<void> {
  assertCurrent();
  await session.state.set({
    yolo: false,
    permissionRules: permissionRulesForAccessLevel("read-only"),
  });
  assertCurrent();
  const stored = await storedPermission;
  assertCurrent();
  const persisted = readPermissionRecord(stored);
  const persistedLevel = persisted ? threadAccess(persisted.permissionRules) : undefined;
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
  assertCurrent();
  await session.state.set({ yolo: false, permissionRules: record.permissionRules });
  assertCurrent();
  const activeState = session.state.get();
  const durableRecord = await session.thread.getSetting({ key: permissionSettingKey });
  assertCurrent();
  const activeRules = session.permissions.getRules();
  if (
    activeState.yolo !== false ||
    !isDeepStrictEqual(durableRecord, record) ||
    !isDeepStrictEqual(activeRules, record.permissionRules)
  ) {
    throw new Error("Pea permission state did not persist exactly.");
  }
}

function permissionRulesForAccessLevel(level: RuntimeAccessLevel): PermissionRules {
  return { categories: { ...threadAccessPolicies[level] }, tools: {} };
}

function readPermissionRecord(value: unknown): PermissionRecord | undefined {
  const parsed = permissionRecordSchema.safeParse(value);
  if (!parsed.success || !threadAccess(parsed.data.permissionRules)) {
    return undefined;
  }
  return parsed.data;
}
