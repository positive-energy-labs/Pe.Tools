import {
  authenticateRuntimeMethod,
  createRuntimeAuthDescriptor,
  logoutRuntimeAuth,
  type RuntimeAuthDescriptor,
  type RuntimeAuthMethod,
  type RuntimeAuthProfile,
} from "../auth/types.ts";
export { toAcpAuthMethods, toAgUiAuthCapabilities } from "../auth/protocol.ts";

export type PeaRuntimeAuthDescriptor = RuntimeAuthDescriptor;
export type PeaRuntimeAuthMethod = RuntimeAuthMethod;
export type PeaAuthSource = string;

export interface PeaRuntimeAuthOptions {
  authSource?: PeaAuthSource;
  allowOauthBetaAuth?: boolean;
  logout?: () => Promise<void>;
}

export function describePeaRuntimeAuth(options: PeaRuntimeAuthOptions = {}): RuntimeAuthDescriptor {
  const authSource = options.authSource ?? "api-key";
  return createRuntimeAuthDescriptor({
    source: authSource,
    methods: authMethods(authSource, options.allowOauthBetaAuth === true),
    logoutSupported: Boolean(options.logout),
  });
}

export function authenticatePeaRuntimeMethod(
  descriptor: RuntimeAuthDescriptor,
  methodId: string,
): void {
  authenticateRuntimeMethod(descriptor, methodId);
}

export async function logoutPeaRuntimeAuth(profile: RuntimeAuthProfile | undefined): Promise<void> {
  await logoutRuntimeAuth(profile);
}

export function createOpenAiRuntimeAuthProfile(options: {
  authSource?: PeaAuthSource;
  allowOauthBetaAuth?: boolean;
  logout?: () => Promise<void>;
}): RuntimeAuthProfile {
  return {
    descriptor: describePeaRuntimeAuth(options),
    logout: options.logout,
  };
}

function authMethods(authSource: PeaAuthSource, allowOAuth: boolean): RuntimeAuthMethod[] {
  switch (authSource) {
    case "oauth":
      return [codexOauthMethod()];
    case "api-key":
      return [openAiApiKeyMethod(false)];
    case "auto":
      return allowOAuth
        ? [openAiApiKeyMethod(true), codexOauthMethod()]
        : [openAiApiKeyMethod(false)];
    default:
      return [];
  }
}

function openAiApiKeyMethod(optional: boolean): RuntimeAuthMethod {
  return {
    id: "openai-api-key",
    kind: "env_var",
    name: "OpenAI API key",
    description: "Use OPENAI_API_KEY or stored runtime API-key credentials for model access.",
    envName: "OPENAI_API_KEY",
    optional,
  };
}

function codexOauthMethod(): RuntimeAuthMethod {
  return {
    id: "codex-oauth",
    kind: "agent",
    name: "Codex OAuth",
    description: "Use the runtime-managed Codex OAuth credential already stored for this process.",
  };
}
