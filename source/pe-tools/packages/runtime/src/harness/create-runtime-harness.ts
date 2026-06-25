import { Harness, type HarnessConfig, type Session } from "@mastra/core/harness";
import { createRuntimeThreadLock } from "./thread-lock.ts";
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

export type RuntimeHarnessConfig<TState extends Record<string, unknown> = Record<string, unknown>> =
  HarnessConfig<TState>;

type ClosableStorage = { close?: () => Promise<void> | void };

export interface RuntimeInjectedHarnessConfig {
  storage?: ClosableStorage;
  threadLock?: {
    release?: (threadId: string) => Promise<void> | void;
  };
}

export interface CreateRuntimeHarnessOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends object = Harness<TState>,
> {
  config: HarnessConfig<TState>;
  request?: RuntimeCreateRequest;
  harness?: THarness;
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

export interface CreateInjectedRuntimeHarnessOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends object = object,
> extends Omit<CreateRuntimeHarnessOptions<TState, TServices, THarness>, "config" | "harness"> {
  config: RuntimeInjectedHarnessConfig;
  harness: THarness;
}

export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
>(
  options: CreateRuntimeHarnessOptions<TState, TServices, Harness<TState>> & {
    harness?: undefined;
  },
): Promise<RuntimeHandle<TState, TServices, Harness<TState>>>;
export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends object = object,
>(
  options: CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness>,
): Promise<RuntimeHandle<TState, TServices, THarness>>;
export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends object = object,
>(
  options:
    | (CreateRuntimeHarnessOptions<TState, TServices, Harness<TState>> & {
        harness?: undefined;
      })
    | CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness>,
): Promise<RuntimeHandle<TState, TServices, Harness<TState> | THarness>> {
  const request = options.request ?? defaultRuntimeCreateRequest;
  let config: HarnessConfig<TState> | RuntimeInjectedHarnessConfig;
  let harness: Harness<TState> | THarness;
  let session: Session<TState> | undefined;
  let memory: HarnessConfig<TState>["memory"];
  if (hasInjectedRuntimeHarness(options)) {
    config = options.config;
    harness = options.harness;
  } else {
    const resolvedConfig = await resolveRuntimeHarnessConfig(options, request);
    config = resolvedConfig;
    memory = resolvedConfig.memory;
    harness = new Harness<TState>(resolvedConfig);
    await harness.init();
    session = await harness.createSession(createRuntimeSessionIdentity(resolvedConfig, request));
  }
  let closeTask: Promise<void> | null = null;

  return {
    harness,
    session,
    memory,
    workspace: options.workspace,
    auth: options.auth,
    authStorage: options.authStorage,
    hookManager: options.hookManager,
    mcpManager: options.mcpManager,
    metadata: options.metadata,
    close: () => {
      closeTask ??= closeRuntimeHarness(harness, session, config.storage);
      return closeTask;
    },
  };
}

const defaultRuntimeCreateRequest: RuntimeCreateRequest = { protocol: "tui" };

function hasInjectedRuntimeHarness<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends object,
>(
  options:
    | (CreateRuntimeHarnessOptions<TState, TServices, Harness<TState>> & {
        harness?: undefined;
      })
    | CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness>,
): options is CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness> {
  return options.harness !== undefined;
}

async function closeRuntimeHarness<TState extends Record<string, unknown>>(
  harness: Harness<TState> | object,
  session: Session<TState> | undefined,
  storage: ClosableStorage | undefined,
): Promise<void> {
  session?.abort();
  await session?.thread.clearAndReleaseLock();
  let closeError: unknown;
  try {
    const mastra = harness instanceof Harness ? harness.getMastra() : undefined;
    if (mastra?.shutdown) {
      await mastra.shutdown();
    } else {
      await storage?.close?.();
    }
  } catch (error) {
    closeError = error;
  }
  if (closeError) throw closeError;
}

async function resolveRuntimeHarnessConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
  THarness extends object = object,
>(
  options: CreateRuntimeHarnessOptions<TState, RuntimeHandleServices, THarness>,
  request: RuntimeCreateRequest,
): Promise<HarnessConfig<TState>> {
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
  config: HarnessConfig<TState>,
  request: RuntimeCreateRequest,
): { id: string; ownerId: string; resourceId?: string } {
  const resourceId = config.resourceId ?? config.id;
  return {
    id: `${resourceId}:${request.protocol}`,
    ownerId: process.env.COMPUTERNAME ?? process.env.USERNAME ?? "local",
    resourceId,
  };
}
