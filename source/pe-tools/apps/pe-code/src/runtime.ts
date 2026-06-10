import {
  createOpenAiRuntimeAuthProfile,
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeHarness,
  mergeRuntimeToolCatalogs,
  type RuntimeAuthProfile,
  type RuntimeCreateRequest,
  type RuntimeDescriptor,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHarnessConfig,
  type RuntimeToolSource,
} from "@pe/runtime";
import { peCodeToolCatalog } from "@pe/tools/dev";
import { peaProductToolCatalog } from "@pe/tools/pea";

export const defaultPeCodeRuntimeToolCatalog = mergeRuntimeToolCatalogs(
  peaProductToolCatalog,
  peCodeToolCatalog,
);

export interface PeCodeRuntimeFactoryOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  config: RuntimeHarnessConfig<TState>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  metadata?: Record<string, unknown>;
  toolCatalog?: RuntimeToolSource;
  createHandle?: (request: RuntimeCreateRequest) => Promise<RuntimeHandle<TState>>;
}

export function createPeCodeRuntimeFactory<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: PeCodeRuntimeFactoryOptions<TState>): RuntimeFactory<TState> {
  const descriptor =
    options.descriptor ??
    createRuntimeDescriptor("pe-code", {
      modeName: "Build",
      agentName: "Pe.Tools Dev Agent",
      title: "pe-code",
      description: "Pe.Tools repo coding agent.",
    });
  const auth = options.auth ?? createPeCodeRuntimeAuthProfile();
  const toolCatalog = options.toolCatalog ?? defaultPeCodeRuntimeToolCatalog;

  return createRuntimeFactory(
    descriptor,
    async (request) =>
      options.createHandle?.(request) ??
      createRuntimeHarness({
        config: options.config,
        auth,
        toolCatalog,
        metadata: {
          ...options.metadata,
          runtimeId: descriptor.id,
          protocol: request.protocol,
          cwd: request.cwd,
          workspaceRoot: request.workspaceRoot,
        },
      }),
    auth,
  );
}

export function createPeCodeRuntimeAuthProfile(
  options: {
    source?: string;
    allowOauthBetaAuth?: boolean;
  } = {},
): RuntimeAuthProfile {
  return createOpenAiRuntimeAuthProfile({
    ...options,
    apiKeyDescription:
      "Use OPENAI_API_KEY or stored dev-agent API-key credentials for model access.",
  });
}
