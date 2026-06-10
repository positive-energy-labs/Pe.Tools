import { Harness, type HarnessConfig } from "@mastra/core/harness";
import { createRuntimeSessions, type RuntimeSessionOptions } from "../session/runtime-sessions.ts";
import type { RuntimeAuthProfile } from "../auth/types.ts";
import type { RuntimeHandle, RuntimeSessions, RuntimeWorkspaceInfo } from "../runtime.ts";
import type { RuntimeToolSource } from "../tool-metadata.ts";

export type RuntimeHarnessConfig<TState extends Record<string, unknown> = Record<string, unknown>> =
  HarnessConfig<TState>;

export interface CreateRuntimeHarnessOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  config: HarnessConfig<TState>;
  harness?: Harness<TState>;
  sessions?: RuntimeSessions;
  sessionOptions?: RuntimeSessionOptions;
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
  const harness = options.harness ?? new Harness<TState>(options.config);
  const sessions =
    options.sessions ??
    options.createSessions?.(harness) ??
    createRuntimeSessions(harness as unknown as Harness<Record<string, unknown>>, {
      ...options.sessionOptions,
      toolCatalog: options.toolCatalog ?? options.sessionOptions?.toolCatalog,
    });

  return {
    harness,
    sessions,
    workspace: options.workspace,
    auth: options.auth,
    authStorage: options.authStorage,
    hookManager: options.hookManager,
    mcpManager: options.mcpManager,
    metadata: options.metadata,
  };
}
