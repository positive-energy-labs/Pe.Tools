import {
  AgentController,
  type AgentControllerConfig,
  type Session,
} from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { analyticsEnabled, boundedPayload, capture } from "../analytics.ts";
import { createRuntimeThreadLock } from "../thread-lock.ts";
import type { RuntimeMemoryProfile } from "../memory/profiles.ts";
import type {
  RuntimeCreateRequest,
  RuntimeHandle,
  RuntimeHandleServices,
  RuntimeWorkspaceInfo,
} from "../runtime.ts";
import type { RuntimeStorageProfile } from "../storage/profiles.ts";

export type RuntimeControllerConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
> = AgentControllerConfig<TState>;

type ClosableStorage = { close?: () => Promise<void> | void };
type SettleableMemory = { settled(): Promise<void> };

export interface RuntimeInjectedControllerConfig {
  storage?: ClosableStorage;
  threadLock?: {
    release?: (threadId: string) => Promise<void> | void;
  };
}

export interface CreateRuntimeControllerOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  TController extends object = AgentController<TState>,
> {
  config: AgentControllerConfig<TState>;
  request?: RuntimeCreateRequest;
  controller?: TController;
  storageProfile?: RuntimeStorageProfile;
  memoryProfile?: RuntimeMemoryProfile<TState>;
  workspace?: RuntimeWorkspaceInfo;
  authStorage?: TServices["authStorage"];
  metadata?: Record<string, unknown>;
}

export interface CreateInjectedRuntimeControllerOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  TController extends object = object,
> extends Omit<
  CreateRuntimeControllerOptions<TState, TServices, TController>,
  "config" | "controller"
> {
  config: RuntimeInjectedControllerConfig;
  controller: TController;
}

export async function createRuntimeController<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
>(
  options: CreateRuntimeControllerOptions<TState, TServices, AgentController<TState>> & {
    controller?: undefined;
  },
): Promise<RuntimeHandle<TState, TServices, AgentController<TState>>>;
export async function createRuntimeController<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  TController extends object = object,
>(
  options: CreateInjectedRuntimeControllerOptions<TState, TServices, TController>,
): Promise<RuntimeHandle<TState, TServices, TController>>;
export async function createRuntimeController<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  TController extends object = object,
>(
  options:
    | (CreateRuntimeControllerOptions<TState, TServices, AgentController<TState>> & {
        controller?: undefined;
      })
    | CreateInjectedRuntimeControllerOptions<TState, TServices, TController>,
): Promise<RuntimeHandle<TState, TServices, AgentController<TState> | TController>> {
  const request = options.request ?? defaultRuntimeCreateRequest;
  let config: AgentControllerConfig<TState> | RuntimeInjectedControllerConfig;
  let controller: AgentController<TState> | TController;
  let session: Session<TState> | undefined;
  let memory: AgentControllerConfig<TState>["memory"];
  let ownedMemory: SettleableMemory | undefined;
  let mastra: Mastra | undefined;
  let unsubscribe: (() => void) | undefined;
  if (hasInjectedRuntimeController(options)) {
    config = options.config;
    controller = options.controller;
    mastra = controller instanceof AgentController ? controller.getMastra() : undefined;
  } else {
    const createOptions = options as CreateRuntimeControllerOptions<
      TState,
      RuntimeHandleServices,
      AgentController<TState>
    >;
    const resolvedConfig = await resolveRuntimeControllerConfig(createOptions, request);
    config = resolvedConfig;
    memory = resolvedConfig.memory;
    ownedMemory = typeof memory === "function" ? undefined : memory;
    const built = new AgentController<TState>(resolvedConfig);
    // Register on an explicit Mastra (keyed by config.id) BEFORE init so the
    // controller inherits it instead of spinning up an internal one. This is the
    // handle @mastra/server mounts to expose the native agent-controller routes.
    // Share the controller's storage so durability is configured in one place.
    mastra = new Mastra({
      agentControllers: { [resolvedConfig.id]: built },
      ...(resolvedConfig.storage ? { storage: resolvedConfig.storage } : {}),
    });
    await built.init();
    session = await built.createSession(createRuntimeSessionIdentity(resolvedConfig, request));
    unsubscribe = instrumentRuntimeSession(session, request.protocol);
    controller = built;
  }
  let closeTask: Promise<void> | null = null;

  return {
    controller,
    mastra,
    session,
    memory,
    workspace: options.workspace,
    authStorage: options.authStorage,
    metadata: options.metadata,
    close: () => {
      closeTask ??= closeRuntimeController(
        session,
        ownedMemory,
        unsubscribe,
        hasInjectedRuntimeController(options) ? undefined : mastra,
        hasInjectedRuntimeController(options) ? config.storage : undefined,
      );
      return closeTask;
    },
  };
}

const defaultRuntimeCreateRequest: RuntimeCreateRequest = { protocol: "tui" };

/**
 * The one cross-surface analytics seam: every runtime (TUI, headless prompt, host web,
 * ACP) passes through here, so prompts, tool calls, and turn usage are captured once
 * with a `surface` dimension instead of per-transport.
 */
function instrumentRuntimeSession(
  session: object | undefined,
  surface: string,
): (() => void) | undefined {
  if (!session || !analyticsEnabled()) return;
  const target = session as unknown as {
    sendMessage?: (request: { content?: string }) => Promise<void>;
    subscribe?: (listener: (event: unknown) => void) => () => void;
  };
  try {
    const originalSend = target.sendMessage?.bind(session);
    if (originalSend) {
      target.sendMessage = (request) => {
        const prompt = boundedPayload(request?.content ?? request);
        capture("pea_prompt", {
          surface,
          prompt: prompt.json,
          prompt_truncated: prompt.truncated,
          prompt_bytes: prompt.bytes,
        });
        return originalSend(request);
      };
    }
    return target.subscribe?.((event) => {
      const record = (event ?? {}) as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";
      if (type !== "tool_end" && type !== "agent_end" && type !== "error") return;
      const payload = boundedPayload(record);
      const eventName =
        type === "tool_end" ? "tool_call" : type === "error" ? "agent_error" : "agent_turn";
      // agent_end carries per-turn model usage (tokens) when the provider reports it —
      // that is the token/cost stream until a dedicated LLM-analytics model wrap exists.
      capture(eventName, {
        surface,
        tool: typeof record.toolName === "string" ? record.toolName : undefined,
        payload: payload.json,
        payload_truncated: payload.truncated,
        payload_bytes: payload.bytes,
      });
    });
  } catch {
    // Analytics must never break runtime construction.
  }
}

function hasInjectedRuntimeController<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  TController extends object,
>(
  options:
    | (CreateRuntimeControllerOptions<TState, TServices, AgentController<TState>> & {
        controller?: undefined;
      })
    | CreateInjectedRuntimeControllerOptions<TState, TServices, TController>,
): options is CreateInjectedRuntimeControllerOptions<TState, TServices, TController> {
  return options.controller !== undefined;
}

async function closeRuntimeController<TState extends Record<string, unknown>>(
  session: Session<TState> | undefined,
  memory: SettleableMemory | undefined,
  unsubscribe: (() => void) | undefined,
  mastra: Mastra | undefined,
  storage: ClosableStorage | undefined,
): Promise<void> {
  session?.abort();
  unsubscribe?.();
  await memory?.settled();
  await session?.thread.clearAndReleaseLock();
  if (!mastra) return await storage?.close?.();
  await mastra.shutdown();
}

async function resolveRuntimeControllerConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TController extends object = object,
>(
  options: CreateRuntimeControllerOptions<TState, RuntimeHandleServices, TController>,
  request: RuntimeCreateRequest,
): Promise<AgentControllerConfig<TState>> {
  const storage =
    options.config.storage ??
    (options.storageProfile ? await options.storageProfile.createStore(request) : undefined);
  await initializeRuntimeStorage(storage);

  if (!options.config.memory && options.memoryProfile && !storage) {
    throw new Error("Runtime memory profile requires a runtime storage profile or config.storage.");
  }

  const memory =
    options.config.memory ??
    (options.memoryProfile && storage
      ? await options.memoryProfile.createMemory({ storage, request, config: options.config })
      : undefined);

  const threadLock =
    options.config.threadLock ??
    createRuntimeThreadLock({ storageProfileKind: options.storageProfile?.kind });

  return {
    ...options.config,
    ...(storage ? { storage } : {}),
    ...(memory ? { memory } : {}),
    threadLock,
  };
}

type InitializableStorage = { disableInit?: boolean; init?: () => Promise<void> | void };

async function initializeRuntimeStorage(storage: InitializableStorage | undefined): Promise<void> {
  if (!storage || storage.disableInit) return;
  await storage.init?.();
}

function createRuntimeSessionIdentity<TState extends Record<string, unknown>>(
  config: AgentControllerConfig<TState>,
  request: RuntimeCreateRequest,
): { id: string; ownerId: string; resourceId?: string; tags?: Record<string, string> } {
  const resourceId = config.resourceId ?? config.id;
  return {
    id: `${resourceId}:${request.protocol}`,
    ownerId: process.env.COMPUTERNAME ?? process.env.USERNAME ?? "local",
    resourceId,
    ...(request.workspaceRoot ? { tags: { projectPath: request.workspaceRoot } } : {}),
  };
}
