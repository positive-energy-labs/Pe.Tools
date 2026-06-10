import {
  createPeaCloudGatewayRuntimeAuthProfile,
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeHarness,
  type RuntimeAuthProfile,
  type RuntimeCreateRequest,
  type RuntimeDescriptor,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHarnessConfig,
  type RuntimeToolSource,
} from "@pe/runtime";
import { peaProductToolCatalog } from "@pe/tools/pea";

export const defaultPeaRuntimeToolCatalog = peaProductToolCatalog;

export interface PeaRuntimeFactoryOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  config: RuntimeHarnessConfig<TState>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  metadata?: Record<string, unknown>;
  toolCatalog?: RuntimeToolSource;
  createHandle?: (request: RuntimeCreateRequest) => Promise<RuntimeHandle<TState>>;
}

export function createPeaRuntimeFactory<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(options: PeaRuntimeFactoryOptions<TState>): RuntimeFactory<TState> {
  const descriptor =
    options.descriptor ??
    createRuntimeDescriptor("pea", {
      modeName: "Pea",
      agentName: "Pea",
      title: "Pea",
      description: "Positive Energy Revit/operator workbench.",
    });
  const auth = options.auth ?? createPeaRuntimeAuthProfile();

  return createRuntimeFactory(
    descriptor,
    async (request) =>
      options.createHandle?.(request) ??
      createRuntimeHarness({
        config: options.config,
        auth,
        toolCatalog: options.toolCatalog ?? defaultPeaRuntimeToolCatalog,
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

export function createPeaRuntimeAuthProfile(
  options: {
    source?: string;
    allowOauthBetaAuth?: boolean;
    logout?: () => Promise<void>;
  } = {},
): RuntimeAuthProfile {
  return createPeaCloudGatewayRuntimeAuthProfile({
    ...options,
    apiKeyDescription: "Use OPENAI_API_KEY only as a local Pea model-access escape hatch.",
  });
}
