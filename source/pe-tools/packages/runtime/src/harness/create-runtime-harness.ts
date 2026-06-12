import { Harness, type HarnessConfig } from "@mastra/core/harness";
import { wrapModelForFinalToolListLogging } from "./final-tool-list-logging.ts";
import { createRuntimeSessions, type RuntimeSessionOptions } from "../session/runtime-sessions.ts";
import type { RuntimeAuthProfile } from "../auth/types.ts";
import type { RuntimeMemoryProfile } from "../memory/profiles.ts";
import type {
  RuntimeCreateRequest,
  RuntimeHandle,
  RuntimeSessions,
  RuntimeWorkspaceInfo,
} from "../runtime.ts";
import type { RuntimeStorageProfile } from "../storage/profiles.ts";
import type { RuntimeToolProfile, RuntimeToolSource } from "../tool-metadata.ts";

export type RuntimeHarnessConfig<TState extends Record<string, unknown> = Record<string, unknown>> =
  HarnessConfig<TState>;

export interface CreateRuntimeHarnessOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  config: HarnessConfig<TState>;
  request?: RuntimeCreateRequest;
  harness?: Harness<TState>;
  sessions?: RuntimeSessions;
  sessionOptions?: RuntimeSessionOptions;
  storageProfile?: RuntimeStorageProfile;
  memoryProfile?: RuntimeMemoryProfile<TState>;
  toolProfile?: RuntimeToolProfile;
  toolCatalog?: RuntimeToolSource;
  createSessions?: (harness: Harness<TState>) => RuntimeSessions;
  workspace?: RuntimeWorkspaceInfo;
  auth?: RuntimeAuthProfile;
  authStorage?: unknown;
  hookManager?: unknown;
  mcpManager?: unknown;
  metadata?: Record<string, unknown>;
}

export async function createRuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: CreateRuntimeHarnessOptions<TState>): Promise<RuntimeHandle<TState>> {
  const request = options.request ?? defaultRuntimeCreateRequest;
  const config = options.harness
    ? options.config
    : await resolveRuntimeHarnessConfig(options, request);
  const harness = options.harness ?? new Harness<TState>(config);
  const sessions =
    options.sessions ??
    options.createSessions?.(harness) ??
    createRuntimeSessions(harness as unknown as Harness<Record<string, unknown>>, {
      ...options.sessionOptions,
      toolCatalog:
        options.toolCatalog ?? options.toolProfile?.catalog ?? options.sessionOptions?.toolCatalog,
    });

  let closeTask: Promise<void> | null = null;

  return {
    harness,
    sessions,
    workspace: options.workspace,
    auth: options.auth,
    authStorage: options.authStorage,
    hookManager: options.hookManager,
    mcpManager: options.mcpManager,
    metadata: options.metadata,
    close: () => {
      closeTask ??= closeRuntimeHarness(harness, config.storage);
      return closeTask;
    },
  };
}

const defaultRuntimeCreateRequest: RuntimeCreateRequest = { protocol: "tui" };

type ClosableStorage = { close?: () => Promise<void> | void };
type ShutdownMastra = { shutdown?: () => Promise<void> | void };
type HarnessWithMastra<TState extends Record<string, unknown>> = Harness<TState> & {
  getMastra?: () => ShutdownMastra | undefined;
};

async function closeRuntimeHarness<TState extends Record<string, unknown>>(
  harness: Harness<TState>,
  storage: ClosableStorage | undefined,
): Promise<void> {
  harness.abort();
  const mastra = (harness as HarnessWithMastra<TState>).getMastra?.();
  if (mastra?.shutdown) {
    await mastra.shutdown();
    return;
  }
  await storage?.close?.();
}

async function resolveRuntimeHarnessConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(
  options: CreateRuntimeHarnessOptions<TState>,
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
  const configuredResolveModel = options.config.resolveModel;
  const resolveModel = configuredResolveModel
    ? (modelId: string) => wrapModelForFinalToolListLogging(configuredResolveModel(modelId))
    : undefined;

  return {
    ...options.config,
    ...(storage ? { storage } : {}),
    ...(memory ? { memory } : {}),
    ...(tools ? { tools } : {}),
    ...(resolveModel ? { resolveModel } : {}),
  };
}

type InitializableStorage = { disableInit?: boolean; init?: () => Promise<void> | void };

async function initializeRuntimeStorage(storage: InitializableStorage | undefined): Promise<void> {
  if (!storage || storage.disableInit) return;
  await storage.init?.();
}
