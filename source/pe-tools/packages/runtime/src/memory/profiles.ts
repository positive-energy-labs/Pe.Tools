import { Memory } from "@mastra/memory";
import type { HarnessConfig } from "@mastra/core/harness";
import type { MemoryConfigInternal, SharedMemoryConfig } from "@mastra/core/memory";
import type { MastraCompositeStore } from "@mastra/core/storage";
import type { RuntimeCreateRequest } from "../runtime.ts";

const defaultRuntimeOmModelId = "openai/gpt-5.4-mini";
const defaultRuntimeObservationThreshold = 75_000;
const defaultRuntimeReflectionThreshold = 15_000;

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
    model: defaultRuntimeOmModelId,
    temporalMarkers: true,
    activateAfterIdle: "auto",
    activateOnProviderChange: true,
    retrieval: { scope: "thread" },
    observation: {
      messageTokens: defaultRuntimeObservationThreshold,
      previousObserverTokens: 1_000,
      threadTitle: true,
      instruction: runtimeEphemeralContextObserverInstruction,
      observeAttachments: "auto",
    },
    reflection: {
      observationTokens: defaultRuntimeReflectionThreshold,
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
