import {
  codexOauthAuthMethod,
  mastraGatewayApiKeyAuthMethod,
  openAiApiKeyAuthMethod,
  peaCloudGatewayAuthMethod,
} from "./methods.ts";
import {
  createRuntimeAuthDescriptor,
  type RuntimeAuthMethod,
  type RuntimeAuthProfile,
} from "./types.ts";

export interface RuntimeAuthProfileOptions {
  source?: string;
  allowOauthBetaAuth?: boolean;
  logout?: () => Promise<void>;
  apiKeyDescription?: string;
}

export function createOpenAiRuntimeAuthProfile(
  options: RuntimeAuthProfileOptions = {},
): RuntimeAuthProfile {
  const source = options.source ?? "auto";
  return {
    descriptor: createRuntimeAuthDescriptor({
      source,
      methods: openAiAuthMethods(source, options),
      logoutSupported: Boolean(options.logout),
    }),
    logout: options.logout,
  };
}

export function createPeaCloudGatewayRuntimeAuthProfile(
  options: RuntimeAuthProfileOptions = {},
): RuntimeAuthProfile {
  const source = options.source ?? "gateway";
  return {
    descriptor: createRuntimeAuthDescriptor({
      source,
      methods: peaGatewayAuthMethods(source, options),
      logoutSupported: Boolean(options.logout),
      metadata: peaGatewayAuthMetadata(source),
    }),
    logout: options.logout,
  };
}

function openAiAuthMethods(
  source: string,
  options: RuntimeAuthProfileOptions,
): RuntimeAuthMethod[] {
  switch (source) {
    case "oauth":
      return [codexOauthAuthMethod()];
    case "auto":
      return options.allowOauthBetaAuth === true
        ? [
            openAiApiKeyAuthMethod({ optional: true, description: options.apiKeyDescription }),
            codexOauthAuthMethod(),
          ]
        : [openAiApiKeyAuthMethod({ description: options.apiKeyDescription })];
    case "api-key":
      return [openAiApiKeyAuthMethod({ description: options.apiKeyDescription })];
    case "mastra-gateway":
      return [mastraGatewayApiKeyAuthMethod()];
    default:
      return [];
  }
}

function peaGatewayAuthMetadata(source: string): Record<string, unknown> | undefined {
  if (source === "gateway" || source === "auto") {
    return {
      gateway: "mastra",
      gatewayAuthority: "pea-cloud",
    };
  }
  if (source === "mastra-gateway") {
    return {
      gateway: "mastra",
      gatewayAuthority: "local-api-key",
    };
  }
  return undefined;
}

function peaGatewayAuthMethods(
  source: string,
  options: RuntimeAuthProfileOptions,
): RuntimeAuthMethod[] {
  switch (source) {
    case "gateway":
      return [peaCloudGatewayAuthMethod()];
    case "mastra-gateway":
      return [mastraGatewayApiKeyAuthMethod()];
    case "api-key":
      return [openAiApiKeyAuthMethod({ description: options.apiKeyDescription })];
    case "oauth":
      return [codexOauthAuthMethod()];
    case "auto":
      return options.allowOauthBetaAuth === true
        ? [
            peaCloudGatewayAuthMethod(),
            openAiApiKeyAuthMethod({ optional: true, description: options.apiKeyDescription }),
            codexOauthAuthMethod(),
          ]
        : [
            peaCloudGatewayAuthMethod(),
            openAiApiKeyAuthMethod({ optional: true, description: options.apiKeyDescription }),
          ];
    default:
      return [];
  }
}
