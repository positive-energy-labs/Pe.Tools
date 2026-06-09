import {
  createPea,
  createPeaDev,
  type DevAgentOptions,
  type DevAgentRuntime,
  type PeaAgentOptions,
  type PeaRuntime,
  type PeaRuntimeId,
} from "./pea-runtime.js";
import type { PeaRuntimeProtocol } from "./pea-runtime-events.js";

export type PeaAnyRuntime = PeaRuntime | DevAgentRuntime;

export interface PeaRuntimeFactoryOptions {
  runtime: PeaRuntimeId;
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  modelId?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAgentOptions["authSource"];
}

export interface PeaRuntimeFactoryRequest {
  cwd?: string;
  protocol: PeaRuntimeProtocol;
}

export interface PeaRuntimeFactory {
  runtimeId: PeaRuntimeId;
  create(request: PeaRuntimeFactoryRequest): Promise<PeaAnyRuntime>;
}

export type PeaRuntimeCreateRequest =
  | { runtime: "pea"; options: PeaAgentOptions }
  | { runtime: "dev-agent"; options: DevAgentOptions };

export interface PeaRuntimeDescriptor {
  id: PeaRuntimeId;
  modeName: string;
  agentName: string;
  title: string;
  description: string;
}

export function createPeaRuntimeFactory(options: PeaRuntimeFactoryOptions): PeaRuntimeFactory {
  return {
    runtimeId: options.runtime,
    create(request) {
      const runtimeRequest = resolvePeaRuntimeCreateRequest(options, request.cwd);
      return runtimeRequest.runtime === "pea"
        ? createPea(runtimeRequest.options)
        : createPeaDev(runtimeRequest.options);
    },
  };
}

export function resolvePeaRuntimeCreateRequest(
  options: PeaRuntimeFactoryOptions,
  cwd?: string,
): PeaRuntimeCreateRequest {
  if (options.runtime === "pea") {
    return {
      runtime: "pea",
      options: {
        hostBaseUrl: options.hostBaseUrl,
        workspaceKey: options.workspaceKey,
        workspaceRoot: options.workspaceRoot,
        allowOauthBetaAuth: options.allowOauthBetaAuth,
        authSource: options.authSource,
      },
    };
  }

  return {
    runtime: "dev-agent",
    options: {
      hostBaseUrl: options.hostBaseUrl,
      workspaceKey: options.workspaceKey,
      workspaceRoot: options.workspaceRoot ?? cwd,
      modelId: options.modelId,
      allowOauthBetaAuth: options.allowOauthBetaAuth,
      authSource: options.authSource,
    },
  };
}

export function describePeaRuntime(runtimeId: PeaRuntimeId): PeaRuntimeDescriptor {
  return runtimeId === "dev-agent"
    ? {
        id: "dev-agent",
        modeName: "dev-agent",
        agentName: "Pe.Tools dev-agent",
        title: "Pe.Tools Dev Agent",
        description: "Pe.Tools repo coding agent.",
      }
    : {
        id: "pea",
        modeName: "Pea",
        agentName: "Pea",
        title: "Pea",
        description: "Deployed Pea Revit/operator workbench.",
      };
}
