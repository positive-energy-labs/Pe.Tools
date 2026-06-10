import type { RuntimeAuthMethod } from "./types.ts";

export function runtimeAgentAuthMethod(options: {
  id: string;
  name: string;
  description: string;
}): RuntimeAuthMethod {
  return {
    id: options.id,
    kind: "agent",
    name: options.name,
    description: options.description,
  };
}

export function runtimeEnvVarAuthMethod(options: {
  id: string;
  name: string;
  description: string;
  envName: string;
  optional?: boolean;
}): RuntimeAuthMethod {
  return {
    id: options.id,
    kind: "env_var",
    name: options.name,
    description: options.description,
    envName: options.envName,
    optional: options.optional === true,
  };
}

export function openAiApiKeyAuthMethod(options: { optional?: boolean; description?: string } = {}) {
  return runtimeEnvVarAuthMethod({
    id: "openai-api-key",
    name: "OpenAI API key",
    description:
      options.description ??
      "Use OPENAI_API_KEY or stored runtime API-key credentials for model access.",
    envName: "OPENAI_API_KEY",
    optional: options.optional,
  });
}

export function mastraGatewayApiKeyAuthMethod(options: { optional?: boolean } = {}) {
  return runtimeEnvVarAuthMethod({
    id: "mastra-gateway-api-key",
    name: "Mastra Gateway API key",
    description: "Use MASTRA_GATEWAY_API_KEY for Mastra Gateway model routing and memory access.",
    envName: "MASTRA_GATEWAY_API_KEY",
    optional: options.optional,
  });
}

export function peaCloudGatewayAuthMethod() {
  return runtimeAgentAuthMethod({
    id: "pea-cloud-gateway",
    name: "Pea Cloud Gateway",
    description: "Use the runtime-managed Pea Cloud token for sponsored Gateway model access.",
  });
}

export function codexOauthAuthMethod() {
  return runtimeAgentAuthMethod({
    id: "codex-oauth",
    name: "Codex OAuth",
    description: "Use the runtime-managed Codex OAuth credential already stored for this process.",
  });
}
