import type { PeaAuthSource } from "./beta-auth-bootstrap.js";
import { describePeaRuntimeAuth, type PeaRuntimeAuthMethod } from "./pea-runtime-auth.js";
import { describePeaRuntime } from "./pea-runtime-factory.js";
import type { PeaRuntimeId } from "./pea-runtime.js";

export type PeaRuntimeProtocolStatusProtocol = "acp" | "ag-ui";

export interface PeaRuntimeProtocolStatusOptions {
  runtimeId: PeaRuntimeId;
  protocol: PeaRuntimeProtocolStatusProtocol;
  transport: string;
  sessions: number;
  authSource?: PeaAuthSource;
  allowOauthBetaAuth?: boolean;
  capabilities?: unknown;
}

export interface PeaRuntimeProtocolStatus {
  status: "ok";
  runtime: PeaRuntimeId;
  protocol: PeaRuntimeProtocolStatusProtocol;
  transport: string;
  runtimeInfo: {
    id: PeaRuntimeId;
    name: string;
    title: string;
    description: string;
  };
  auth: {
    source: PeaAuthSource;
    logoutSupported: boolean;
    methods: PeaRuntimeAuthMethod[];
  };
  sessions: number;
  capabilities?: unknown;
}

export function describePeaRuntimeProtocolStatus(
  options: PeaRuntimeProtocolStatusOptions,
): PeaRuntimeProtocolStatus {
  const runtime = describePeaRuntime(options.runtimeId);
  const auth = describePeaRuntimeAuth({
    runtimeId: options.runtimeId,
    authSource: options.authSource,
    allowOauthBetaAuth: options.allowOauthBetaAuth,
  });

  return {
    status: "ok",
    runtime: runtime.id,
    protocol: options.protocol,
    transport: options.transport,
    runtimeInfo: {
      id: runtime.id,
      name: runtime.agentName,
      title: runtime.title,
      description: runtime.description,
    },
    auth: {
      source: auth.authSource,
      logoutSupported: auth.logoutSupported,
      methods: auth.methods,
    },
    sessions: options.sessions,
    capabilities: options.capabilities,
  };
}
