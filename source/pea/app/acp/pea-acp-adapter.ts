import type {
  Agent,
  AuthenticateResponse,
  CancelNotification,
  ClientCapabilities,
  CloseSessionRequest,
  DeleteSessionRequest,
  DeleteSessionResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LogoutRequest,
  LogoutResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionId,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import type { PeaAgentOptions } from "../pea-runtime.js";
import {
  authenticatePeaRuntimeMethod,
  describePeaRuntimeAuth,
  logoutPeaRuntimeAuth,
  toAcpAuthMethods,
} from "../pea-runtime-auth.js";
import { describePeaRuntime } from "../pea-runtime-factory.js";
import { sanitizeJson } from "../pea-runtime-events.js";
import { createPeaRuntimePrompt, type PeaRuntimePrompt } from "../pea-runtime-prompts.js";
import {
  PeaAcpSessionStore,
  type AcpSession,
  type PeaAcpRuntimeId,
  type PeaAcpSessionUpdateSink,
} from "./acp-session-store.js";

export interface PeaAcpAgentOptions {
  runtime: PeaAcpRuntimeId;
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  modelId?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAgentOptions["authSource"];
  sessionRegistryPath?: string | null;
}

export interface PeaAcpAgentSessionStore {
  createSession(request: { cwd: string; additionalDirectories?: string[] }): Promise<AcpSession>;
  prompt(sessionId: SessionId, prompt: PeaRuntimePrompt): Promise<"end_turn" | "cancelled">;
  cancel(sessionId: SessionId): void;
  resume(request: {
    sessionId: SessionId;
    cwd?: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession>;
  load(request: {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession>;
  fork(request: {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession>;
  list(cwd?: string | null): NonNullable<ListSessionsResponse["sessions"]>;
  delete(sessionId: SessionId): void;
  close(sessionId: SessionId): void;
  closeAll?(): void;
  configureClient?(clientCapabilities: ClientCapabilities | undefined): void;
}

export function createPeaAcpAgent(
  updateSink: PeaAcpSessionUpdateSink,
  options: PeaAcpAgentOptions,
): Agent {
  return new PeaAcpAgent(options, new PeaAcpSessionStore(updateSink, options));
}

export class PeaAcpAgent implements Agent {
  constructor(
    private readonly options: PeaAcpAgentOptions,
    private readonly sessions: PeaAcpAgentSessionStore,
  ) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    this.sessions.configureClient?.(_params.clientCapabilities);
    const descriptor = describePeaRuntime(this.options.runtime);
    const auth = describePeaRuntimeAuth({
      runtimeId: this.options.runtime,
      authSource: this.options.authSource,
      allowOauthBetaAuth: this.options.allowOauthBetaAuth,
    });
    const agentCapabilities: InitializeResponse["agentCapabilities"] = {
      auth: auth.logoutSupported ? { logout: {} } : {},
      promptCapabilities: {
        embeddedContext: true,
      },
      loadSession: true,
      sessionCapabilities: {
        additionalDirectories: {},
        close: {},
        delete: {},
        fork: {},
        list: {},
        resume: {},
      },
    };

    return {
      protocolVersion: 1,
      agentInfo: {
        name: descriptor.agentName,
        title: descriptor.title,
        version: "0.1.0",
      },
      authMethods: toAcpAuthMethods(auth),
      agentCapabilities,
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const descriptor = describePeaRuntime(this.options.runtime);
    const session = await this.sessions.createSession({
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return {
      sessionId: session.id,
      modes: modeState(descriptor),
    };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const stopReason = await this.sessions.prompt(params.sessionId, acpPrompt(params.prompt));
    return { stopReason };
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.cancel(params.sessionId);
  }

  async closeSession(params: CloseSessionRequest): Promise<void> {
    this.sessions.close(params.sessionId);
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return { sessions: this.sessions.list(params.cwd) };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    await this.sessions.resume({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return { modes: modeState(describePeaRuntime(this.options.runtime)) };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    await this.sessions.load({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return { modes: modeState(describePeaRuntime(this.options.runtime)) };
  }

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const session = await this.sessions.fork({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return {
      sessionId: session.id,
      modes: modeState(describePeaRuntime(this.options.runtime)),
    };
  }

  async deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    this.sessions.delete(params.sessionId);
    return {};
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    if (params.modeId !== this.options.runtime) {
      throw new Error(`Unsupported ACP mode '${params.modeId}'.`);
    }
    await this.sessions.resume({ sessionId: params.sessionId });
    return {};
  }

  async authenticate(
    params: Parameters<NonNullable<Agent["authenticate"]>>[0],
  ): Promise<AuthenticateResponse> {
    authenticatePeaRuntimeMethod(
      describePeaRuntimeAuth({
        runtimeId: this.options.runtime,
        authSource: this.options.authSource,
        allowOauthBetaAuth: this.options.allowOauthBetaAuth,
      }),
      params.methodId,
    );
    return {};
  }

  async logout(_params: LogoutRequest): Promise<LogoutResponse> {
    await logoutPeaRuntimeAuth({
      runtimeId: this.options.runtime,
      authSource: this.options.authSource,
      allowOauthBetaAuth: this.options.allowOauthBetaAuth,
    });
    return {};
  }
}

export function promptText(prompt: PromptRequest["prompt"]): string {
  return acpPrompt(prompt).content;
}

export function acpPrompt(prompt: PromptRequest["prompt"]): PeaRuntimePrompt {
  return createPeaRuntimePrompt(
    prompt.map((block, index) => {
      switch (block.type) {
        case "text":
          return { text: block.text };
        case "resource_link": {
          const label = block.title ?? block.name ?? block.uri;
          return {
            text: `Resource: ${label}\n${block.uri}`,
            resource: {
              id: `acp:${index}:resource-link`,
              protocol: "acp",
              kind: "link",
              uri: block.uri,
              name: block.name,
              title: block.title ?? block.name,
              mimeType: block.mimeType ?? undefined,
              metadata: block._meta ? sanitizeJson(block._meta) : undefined,
            },
          };
        }
        case "resource": {
          const resource = block.resource;
          return {
            text: `Embedded resource: ${resource.uri}`,
            resource: {
              id: `acp:${index}:resource`,
              protocol: "acp",
              kind: "embedded",
              uri: resource.uri,
              mimeType: resource.mimeType ?? undefined,
              text: "text" in resource ? resource.text : undefined,
              blob: "blob" in resource ? resource.blob : undefined,
              metadata: block._meta ? sanitizeJson(block._meta) : undefined,
            },
          };
        }
        case "image":
        case "audio":
          return {
            text: `[ACP ${block.type} content omitted from text prompt]`,
            resource: {
              id: `acp:${index}:${block.type}`,
              protocol: "acp",
              kind: "input",
              mimeType: block.mimeType,
              data: block.data,
              metadata: block._meta ? sanitizeJson(block._meta) : undefined,
            },
          };
        default:
          return { text: `[Unsupported ACP content block: ${(block as { type: string }).type}]` };
      }
    }),
  );
}

function modeState(
  descriptor: ReturnType<typeof describePeaRuntime>,
): NonNullable<NewSessionResponse["modes"]> {
  return {
    currentModeId: descriptor.id,
    availableModes: [
      {
        id: descriptor.id,
        name: descriptor.modeName,
        description: descriptor.description,
      },
    ],
  };
}
