import { Harness, type HarnessConfig } from "@mastra/core/harness";
import { wrapModelForFinalToolListLogging } from "./final-tool-list-logging.ts";
import { RuntimeHarness } from "./runtime-harness.ts";
import { createRuntimeThreadLock } from "./thread-lock.ts";
import {
  createRuntimeKernel,
  type RuntimeKernelHarness,
  type RuntimeKernelOptions,
} from "../kernel.ts";
import type { RuntimeAuthProfile } from "../auth/types.ts";
import type { RuntimeMemoryProfile } from "../memory/profiles.ts";
import type {
  RuntimeCreateRequest,
  RuntimeHandle,
  RuntimeHandleServices,
  RuntimeKernel,
  RuntimeWorkspaceInfo,
} from "../runtime.ts";
import type { RuntimeStorageProfile } from "../storage/profiles.ts";
import { resolveRuntimeThreadStateStore } from "../storage/thread-state.ts";
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
  THarness extends RuntimeKernelHarness<TState> = Harness<TState>,
> {
  config: HarnessConfig<TState>;
  request?: RuntimeCreateRequest;
  harness?: THarness;
  sessionOptions?: RuntimeKernelOptions;
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
  THarness extends RuntimeKernelHarness<TState> = RuntimeKernelHarness<TState>,
> extends Omit<CreateRuntimeHarnessOptions<TState, TServices, THarness>, "config" | "harness"> {
  config: RuntimeInjectedHarnessConfig;
  harness: THarness;
}

export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
>(
  options: CreateRuntimeHarnessOptions<TState, TServices, RuntimeHarness<TState>> & {
    harness?: undefined;
  },
): Promise<RuntimeHandle<TState, TServices, RuntimeHarness<TState>>>;
export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeKernelHarness<TState> = RuntimeKernelHarness<TState>,
>(
  options: CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness>,
): Promise<RuntimeHandle<TState, TServices, THarness>>;
export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeKernelHarness<TState> = RuntimeKernelHarness<TState>,
>(
  options:
    | (CreateRuntimeHarnessOptions<TState, TServices, RuntimeHarness<TState>> & {
        harness?: undefined;
      })
    | CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness>,
): Promise<RuntimeHandle<TState, TServices, RuntimeHarness<TState> | THarness>> {
  const request = options.request ?? defaultRuntimeCreateRequest;
  let config: HarnessConfig<TState> | RuntimeInjectedHarnessConfig;
  let harness: RuntimeHarness<TState> | THarness;
  if (hasInjectedRuntimeHarness(options)) {
    config = options.config;
    harness = options.harness;
  } else {
    const resolvedConfig = await resolveRuntimeHarnessConfig(options, request);
    config = resolvedConfig;
    harness = new RuntimeHarness<TState>(resolvedConfig);
  }
  const kernel = createRuntimeKernel(harness, {
    ...options.sessionOptions,
    threadStateStore:
      options.sessionOptions?.threadStateStore ?? resolveRuntimeThreadStateStore(config.storage),
    storageProfileKind: options.storageProfile?.kind,
    toolCatalog:
      options.toolCatalog ?? options.toolProfile?.catalog ?? options.sessionOptions?.toolCatalog,
  });
  let closeTask: Promise<void> | null = null;

  return {
    harness,
    kernel,
    workspace: options.workspace,
    auth: options.auth,
    authStorage: options.authStorage,
    hookManager: options.hookManager,
    mcpManager: options.mcpManager,
    metadata: options.metadata,
    close: () => {
      closeTask ??= closeRuntimeHarness(harness, kernel, config.storage, config.threadLock);
      return closeTask;
    },
  };
}

const defaultRuntimeCreateRequest: RuntimeCreateRequest = { protocol: "tui" };

function hasInjectedRuntimeHarness<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeKernelHarness<TState>,
>(
  options:
    | (CreateRuntimeHarnessOptions<TState, TServices, RuntimeHarness<TState>> & {
        harness?: undefined;
      })
    | CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness>,
): options is CreateInjectedRuntimeHarnessOptions<TState, TServices, THarness> {
  return options.harness !== undefined;
}

async function closeRuntimeHarness<TState extends Record<string, unknown>>(
  harness: RuntimeKernelHarness<TState>,
  kernel: RuntimeKernel,
  storage: ClosableStorage | undefined,
  threadLock: RuntimeInjectedHarnessConfig["threadLock"] | undefined,
): Promise<void> {
  harness.abort();
  const currentThreadId = harness.getCurrentThreadId();
  let flushError: unknown;
  try {
    await kernel.flushLedger();
  } catch (error) {
    flushError = error;
  } finally {
    const releaseThreadLock = threadLock?.release;
    if (currentThreadId && releaseThreadLock) {
      try {
        await releaseThreadLock(currentThreadId);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
  let closeError: unknown;
  try {
    const mastra = harness.getMastra?.();
    if (mastra?.shutdown) {
      await mastra.shutdown();
    } else {
      await storage?.close?.();
    }
  } catch (error) {
    closeError = error;
  }
  if (flushError) throw flushError;
  if (closeError) throw closeError;
}

async function resolveRuntimeHarnessConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
  THarness extends RuntimeKernelHarness<TState> = RuntimeKernelHarness<TState>,
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
  const toolCatalog =
    options.toolCatalog ?? options.toolProfile?.catalog ?? options.sessionOptions?.toolCatalog;
  const guardedTools =
    typeof tools === "function"
      ? tools
      : tools
        ? guardRuntimeToolsForAccessPolicy(tools, toolCatalog)
        : undefined;
  const configuredResolveModel = options.config.resolveModel;
  const resolveModel = configuredResolveModel
    ? (modelId: string) => wrapModelForFinalToolListLogging(configuredResolveModel(modelId))
    : undefined;
  const threadLock =
    options.config.threadLock ??
    createRuntimeThreadLock({ storageProfileKind: options.storageProfile?.kind });

  return {
    ...options.config,
    ...(storage ? { storage } : {}),
    ...(memory ? { memory } : {}),
    ...(guardedTools ? { tools: guardedTools } : {}),
    ...(resolveModel ? { resolveModel } : {}),
    threadLock,
  };
}

type InitializableStorage = { disableInit?: boolean; init?: () => Promise<void> | void };

async function initializeRuntimeStorage(storage: InitializableStorage | undefined): Promise<void> {
  if (!storage || storage.disableInit) return;
  await storage.init?.();
}
