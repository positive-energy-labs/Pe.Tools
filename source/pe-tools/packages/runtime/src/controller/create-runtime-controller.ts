import {
  AgentController,
  type AgentControllerConfig,
  type Session,
} from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { createRuntimeThreadLock } from "../thread-lock.ts";
import type { RuntimeAuthProfile } from "../auth/types.ts";
import type { RuntimeMemoryProfile } from "../memory/profiles.ts";
import type {
  RuntimeCreateRequest,
  RuntimeHandle,
  RuntimeHandleServices,
  RuntimeWorkspaceInfo,
} from "../runtime.ts";
import type { RuntimeStorageProfile } from "../storage/profiles.ts";
import type { RuntimeToolProfile, RuntimeToolSource } from "../tool-metadata.ts";
import { guardRuntimeToolsForAccessPolicy } from "../tools/access-policy.ts";

export type RuntimeControllerConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
> = AgentControllerConfig<TState>;

type ClosableStorage = { close?: () => Promise<void> | void };

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
  toolProfile?: RuntimeToolProfile;
  toolCatalog?: RuntimeToolSource;
  workspace?: RuntimeWorkspaceInfo;
  auth?: RuntimeAuthProfile;
  authStorage?: TServices["authStorage"];
  hookManager?: TServices["hookManager"];
  mcpManager?: TServices["mcpManager"];
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
  let mastra: Mastra | undefined;
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
    controller = built;
  }
  let closeTask: Promise<void> | null = null;

  return {
    controller,
    mastra,
    session,
    memory,
    workspace: options.workspace,
    auth: options.auth,
    authStorage: options.authStorage,
    hookManager: options.hookManager,
    mcpManager: options.mcpManager,
    metadata: options.metadata,
    close: () => {
      closeTask ??= closeRuntimeController(controller, session, config.storage);
      return closeTask;
    },
  };
}

const defaultRuntimeCreateRequest: RuntimeCreateRequest = { protocol: "tui" };

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
  controller: AgentController<TState> | object,
  session: Session<TState> | undefined,
  storage: ClosableStorage | undefined,
): Promise<void> {
  session?.abort();
  await session?.thread.clearAndReleaseLock();
  let closeError: unknown;
  try {
    if (controller instanceof AgentController) {
      await controller.destroy();
    } else {
      await storage?.close?.();
    }
  } catch (error) {
    closeError = error;
  }
  if (closeError) throw closeError;
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

  const tools = options.config.tools ?? options.toolProfile?.tools;
  const toolCatalog = options.toolCatalog ?? options.toolProfile?.catalog;
  const guardedTools =
    typeof tools === "function"
      ? tools
      : tools
        ? guardRuntimeToolsForAccessPolicy(tools, toolCatalog)
        : undefined;
  const threadLock =
    options.config.threadLock ??
    createRuntimeThreadLock({ storageProfileKind: options.storageProfile?.kind });

  return {
    ...options.config,
    ...(storage ? { storage } : {}),
    ...(memory ? { memory } : {}),
    ...(guardedTools ? { tools: guardedTools } : {}),
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
