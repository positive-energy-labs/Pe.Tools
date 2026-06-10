import type { RuntimeAuthDescriptor, RuntimeAuthMethod } from "./auth/types.ts";
import type { RuntimeDescriptor } from "./runtime.ts";

export type RuntimeProtocolStatusProtocol = "acp" | "ag-ui";

export interface RuntimeProtocolStatusOptions {
  runtime: RuntimeDescriptor;
  auth: RuntimeAuthDescriptor;
  protocol: RuntimeProtocolStatusProtocol;
  transport: string;
  sessions: number;
  capabilities?: unknown;
}

export interface RuntimeProtocolStatus {
  status: "ok";
  runtime: string;
  protocol: RuntimeProtocolStatusProtocol;
  transport: string;
  runtimeInfo: {
    id: string;
    name: string;
    title: string;
    description: string;
  };
  auth: {
    source: string;
    logoutSupported: boolean;
    methods: RuntimeAuthMethod[];
  };
  sessions: number;
  capabilities?: unknown;
}

export function describeRuntimeProtocolStatus(
  options: RuntimeProtocolStatusOptions,
): RuntimeProtocolStatus {
  return {
    status: "ok",
    runtime: options.runtime.id,
    protocol: options.protocol,
    transport: options.transport,
    runtimeInfo: {
      id: options.runtime.id,
      name: options.runtime.agentName,
      title: options.runtime.title,
      description: options.runtime.description,
    },
    auth: {
      source: options.auth.source,
      logoutSupported: options.auth.logoutSupported,
      methods: options.auth.methods,
    },
    sessions: options.sessions,
    capabilities: options.capabilities,
  };
}
