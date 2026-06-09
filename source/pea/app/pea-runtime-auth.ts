import type { AuthMethod } from "@agentclientprotocol/sdk";
import type { AgentCapabilities } from "@ag-ui/core";
import { logoutPeaBetaAuth, type PeaAuthSource } from "./beta-auth-bootstrap.js";
import type { PeaRuntimeId } from "./pea-runtime.js";

export interface PeaRuntimeAuthDescriptor {
  runtimeId: PeaRuntimeId;
  authSource: PeaAuthSource;
  methods: PeaRuntimeAuthMethod[];
  logoutSupported: boolean;
}

export type PeaRuntimeAuthMethod =
  | {
      id: "openai-api-key";
      kind: "env_var";
      name: string;
      description: string;
      envName: "OPENAI_API_KEY";
      optional: boolean;
    }
  | {
      id: "codex-oauth";
      kind: "agent";
      name: string;
      description: string;
    };

export interface PeaRuntimeAuthOptions {
  runtimeId: PeaRuntimeId;
  authSource?: PeaAuthSource;
  allowOauthBetaAuth?: boolean;
  mastraAuthPath?: string;
}

export function describePeaRuntimeAuth(options: PeaRuntimeAuthOptions): PeaRuntimeAuthDescriptor {
  const authSource = options.authSource ?? defaultAuthSource(options.runtimeId);
  return {
    runtimeId: options.runtimeId,
    authSource,
    methods: authMethods(authSource, options.allowOauthBetaAuth === true),
    logoutSupported: options.runtimeId === "pea",
  };
}

export function toAcpAuthMethods(descriptor: PeaRuntimeAuthDescriptor): AuthMethod[] {
  return descriptor.methods.map((method) => {
    if (method.kind === "env_var") {
      return {
        type: "env_var",
        id: method.id,
        name: method.name,
        description: method.description,
        vars: [
          {
            name: method.envName,
            label: "OpenAI API key",
            secret: true,
            optional: method.optional,
          },
        ],
      };
    }

    return {
      id: method.id,
      name: method.name,
      description: method.description,
    };
  });
}

export function toAgUiAuthCapabilities(
  descriptor: PeaRuntimeAuthDescriptor,
): NonNullable<AgentCapabilities["custom"]> {
  return {
    "pea.authSource": descriptor.authSource,
    "pea.logoutSupported": descriptor.logoutSupported,
    "pea.authMethods": descriptor.methods.map((method) => ({
      id: method.id,
      kind: method.kind,
      name: method.name,
    })),
  };
}

export function authenticatePeaRuntimeMethod(
  descriptor: PeaRuntimeAuthDescriptor,
  methodId: string,
): void {
  if (!descriptor.methods.some((method) => method.id === methodId)) {
    throw new Error(`Unsupported Pea runtime auth method '${methodId}'.`);
  }
}

export async function logoutPeaRuntimeAuth(options: PeaRuntimeAuthOptions): Promise<void> {
  if (options.runtimeId !== "pea") {
    throw new Error(`Pea runtime logout is not supported for runtime '${options.runtimeId}'.`);
  }

  await logoutPeaBetaAuth({
    authSource: options.authSource ?? "api-key",
    mastraAuthPath: options.mastraAuthPath,
  });
}

function defaultAuthSource(runtimeId: PeaRuntimeId): PeaAuthSource {
  return runtimeId === "dev-agent" ? "auto" : "api-key";
}

function authMethods(authSource: PeaAuthSource, allowOAuth: boolean): PeaRuntimeAuthMethod[] {
  switch (authSource) {
    case "oauth":
      return [codexOauthMethod()];
    case "api-key":
      return [openAiApiKeyMethod(false)];
    case "auto":
      return allowOAuth
        ? [openAiApiKeyMethod(true), codexOauthMethod()]
        : [openAiApiKeyMethod(false)];
  }
}

function openAiApiKeyMethod(optional: boolean): PeaRuntimeAuthMethod {
  return {
    id: "openai-api-key",
    kind: "env_var",
    name: "OpenAI API key",
    description:
      "Use OPENAI_API_KEY or stored MastraCode API-key credentials for Pea runtime model access.",
    envName: "OPENAI_API_KEY",
    optional,
  };
}

function codexOauthMethod(): PeaRuntimeAuthMethod {
  return {
    id: "codex-oauth",
    kind: "agent",
    name: "Codex OAuth",
    description:
      "Use the runtime-managed Codex OAuth credential already stored for the Pea/dev-agent process.",
  };
}
