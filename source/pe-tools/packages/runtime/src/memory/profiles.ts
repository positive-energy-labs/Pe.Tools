import { Memory } from "@mastra/memory";
import type { HarnessConfig } from "@mastra/core/harness";
import type { MemoryConfigInternal, SharedMemoryConfig } from "@mastra/core/memory";
import type { MastraCompositeStore } from "@mastra/core/storage";
import {
  defaultPeaObservationThreshold,
  defaultPeaOmModelId,
  defaultPeaReflectionThreshold,
} from "../defaults.ts";
import type { RuntimeCreateRequest } from "../runtime.ts";

export type RuntimeHarnessMemory<TState extends Record<string, unknown> = Record<string, unknown>> =
  NonNullable<HarnessConfig<TState>["memory"]>;
export type RuntimeObservationalMemoryConfig = Exclude<
  NonNullable<MemoryConfigInternal["observationalMemory"]>,
  boolean
>;

export interface RuntimeMemoryProfileCreateInput<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  storage: MastraCompositeStore;
  request: RuntimeCreateRequest;
  config: HarnessConfig<TState>;
}

export interface RuntimeMemoryProfile<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  createMemory(
    input: RuntimeMemoryProfileCreateInput<TState>,
  ): RuntimeHarnessMemory<TState> | Promise<RuntimeHarnessMemory<TState>>;
}

export interface RuntimeMastraMemoryProfileOptions {
  id?: string;
  memoryConfig?: Omit<SharedMemoryConfig, "storage" | "options">;
  options?: MemoryConfigInternal;
}

export const runtimeEphemeralContextObserverInstruction = `Only extract durable user, project, preference, and workflow facts.
Do not store dynamic runtime snapshots as truth. Ignore ephemeral current-world context such as <runtime-context>, active Revit document/view/status, protocol/session ids, one-turn resources, prompt fragments, resume decisions, tool approval state, and system-reminder messages including dynamic AGENTS/CLAUDE/CONTEXT injections.
If a fact only describes the current run or UI state, do not observe it.`;

export function createRuntimeMemoryProfile<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: RuntimeMastraMemoryProfileOptions = {}): RuntimeMemoryProfile<TState> {
  return {
    id: options.id ?? "mastra-memory",
    createMemory: ({ storage }) =>
      new Memory({
        ...options.memoryConfig,
        storage,
        options: createRuntimeMemoryOptions(options.options),
      }),
  };
}

export function createPeaRuntimeMemoryProfile<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: RuntimeMastraMemoryProfileOptions = {}): RuntimeMemoryProfile<TState> {
  return createRuntimeMemoryProfile<TState>({
    ...options,
    id: options.id ?? "pea-memory",
    options: createRuntimeMemoryOptions(options.options),
  });
}

export function createPeCodeRuntimeMemoryProfile<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: RuntimeMastraMemoryProfileOptions = {}): RuntimeMemoryProfile<TState> {
  return createRuntimeMemoryProfile<TState>({
    ...options,
    id: options.id ?? "peco-memory",
    options: createRuntimeMemoryOptions(options.options),
  });
}

export function createRuntimeMemoryOptions(
  overrides: MemoryConfigInternal | undefined,
): MemoryConfigInternal {
  const base: MemoryConfigInternal = {
    lastMessages: 10,
    semanticRecall: false,
    generateTitle: false,
    workingMemory: { enabled: false },
    observationalMemory: createRuntimeThreadObservationalMemoryConfig(),
  };

  return {
    ...base,
    ...overrides,
    observationalMemory: mergeObservationalMemoryConfig(
      base.observationalMemory as RuntimeObservationalMemoryConfig,
      overrides?.observationalMemory,
    ),
  };
}

export function createRuntimeThreadObservationalMemoryConfig(
  overrides?: MemoryConfigInternal["observationalMemory"],
): MemoryConfigInternal["observationalMemory"] {
  const base = {
    enabled: true,
    scope: "thread",
    model: defaultPeaOmModelId,
    temporalMarkers: true,
    activateAfterIdle: "auto",
    activateOnProviderChange: true,
    retrieval: { scope: "thread" },
    observation: {
      messageTokens: defaultPeaObservationThreshold,
      previousObserverTokens: 1_000,
      threadTitle: true,
      instruction: runtimeEphemeralContextObserverInstruction,
      observeAttachments: "auto",
    },
    reflection: {
      observationTokens: defaultPeaReflectionThreshold,
    },
  } satisfies RuntimeObservationalMemoryConfig;

  return mergeObservationalMemoryConfig(base, overrides);
}

function mergeObservationalMemoryConfig(
  base: RuntimeObservationalMemoryConfig,
  override: MemoryConfigInternal["observationalMemory"] | undefined,
): MemoryConfigInternal["observationalMemory"] {
  if (override == null) return base;
  if (typeof override === "boolean") return override;

  const merged = {
    ...base,
    ...override,
    observation: {
      ...base.observation,
      ...override.observation,
    },
    reflection: {
      ...base.reflection,
      ...override.reflection,
    },
  };

  if (merged.observation.model || merged.reflection.model) delete merged.model;

  return merged;
}
