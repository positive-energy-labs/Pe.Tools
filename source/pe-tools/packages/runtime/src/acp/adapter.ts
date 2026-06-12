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
import {
  createPeWorkbenchExtension,
  peWorkbenchMetadata,
  type PeWorkbenchExtension,
} from "@pe/agent-contracts";
import {
  authenticateRuntimeMethod,
  createRuntimeAuthDescriptor,
  logoutRuntimeAuth,
  type RuntimeAuthDescriptor,
  type RuntimeAuthProfile,
} from "../auth/types.ts";
import { toAcpAuthMethods } from "../auth/protocol.ts";
import { sanitizeJson } from "../events.ts";
import type { RuntimeDescriptor, RuntimeFactory } from "../runtime.ts";
import { createRuntimePrompt, type RuntimePrompt } from "../prompts.ts";
import type { RuntimeProtocolSessions } from "../session/protocol-sessions.ts";
import {
  RuntimeAcpSessionStore,
  type AcpSession,
  type RuntimeAcpSessionUpdateSink,
} from "./acp-session-store.ts";

export interface RuntimeAcpRuntimeOptions {
  factory: RuntimeFactory;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
}

export interface RuntimeAcpSessionOptions {
  manager?: RuntimeProtocolSessions;
}

export interface RuntimeAcpAgentOptions {
  runtime?: RuntimeAcpRuntimeOptions;
  sessions?: RuntimeAcpSessionOptions;
}

export interface RuntimeAcpAgentSessionStore {
  createSession(request: { cwd: string; additionalDirectories?: string[] }): Promise<AcpSession>;
  prompt(sessionId: SessionId, prompt: RuntimePrompt): Promise<"end_turn" | "cancelled">;
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
  list(cwd?: string | null): Promise<NonNullable<ListSessionsResponse["sessions"]>>;
  delete(sessionId: SessionId): Promise<void>;
  close(sessionId: SessionId): Promise<void>;
  closeAll?(): Promise<void>;
  configureClient?(clientCapabilities: ClientCapabilities | undefined): void;
}

export type PeaAcpAgentOptions = RuntimeAcpAgentOptions;
export type PeaAcpAgentSessionStore = RuntimeAcpAgentSessionStore;

export function createRuntimeAcpAgent(
  updateSink: RuntimeAcpSessionUpdateSink,
  options: RuntimeAcpAgentOptions,
): Agent {
  return new RuntimeAcpAgent(options, new RuntimeAcpSessionStore(updateSink, options));
}

export class RuntimeAcpAgent implements Agent {
  constructor(
    private readonly options: RuntimeAcpAgentOptions,
    private readonly sessions: RuntimeAcpAgentSessionStore,
  ) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    this.sessions.configureClient?.(_params.clientCapabilities);
    const descriptor = runtimeDescriptor(this.options);
    const auth = runtimeAuthDescriptor(this.options);
    const extension = runtimeAcpWorkbenchExtension(this.options);
    const extensionMetadata = peWorkbenchMetadata(extension);
    const agentCapabilities: InitializeResponse["agentCapabilities"] = {
      _meta: extensionMetadata,
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
      _meta: extensionMetadata,
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
    const descriptor = runtimeDescriptor(this.options);
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
    await this.sessions.close(params.sessionId);
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return { sessions: await this.sessions.list(params.cwd) };
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    await this.sessions.resume({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return { modes: modeState(runtimeDescriptor(this.options)) };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    await this.sessions.load({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return { modes: modeState(runtimeDescriptor(this.options)) };
  }

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const session = await this.sessions.fork({
      sessionId: params.sessionId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories,
    });
    return {
      sessionId: session.id,
      modes: modeState(runtimeDescriptor(this.options)),
    };
  }

  async deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    await this.sessions.delete(params.sessionId);
    return {};
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const descriptor = runtimeDescriptor(this.options);
    if (params.modeId !== descriptor.id) {
      throw new Error(`Unsupported ACP mode '${params.modeId}'.`);
    }
    await this.sessions.resume({ sessionId: params.sessionId });
    return {};
  }

  async authenticate(
    params: Parameters<NonNullable<Agent["authenticate"]>>[0],
  ): Promise<AuthenticateResponse> {
    authenticateRuntimeMethod(runtimeAuthDescriptor(this.options), params.methodId);
    return {};
  }

  async logout(_params: LogoutRequest): Promise<LogoutResponse> {
    await logoutRuntimeAuth(runtimeAuthProfile(this.options));
    return {};
  }
}

export function promptText(prompt: PromptRequest["prompt"]): string {
  return acpPrompt(prompt).content;
}

export function acpPrompt(prompt: PromptRequest["prompt"]): RuntimePrompt {
  return createRuntimePrompt(
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
          return {
            text: `[Unsupported ACP content block: ${(block as { type: string }).type}]`,
          };
      }
    }),
  );
}

export function runtimeAcpWorkbenchExtension(
  options: RuntimeAcpAgentOptions,
): PeWorkbenchExtension {
  const descriptor = runtimeAcpDescriptor(options);
  return createPeWorkbenchExtension({
    runtime: {
      id: descriptor.id,
      name: descriptor.agentName,
      title: descriptor.title,
      description: descriptor.description,
    },
    capabilities: {
      threads: true,
      history: true,
      toolCalls: true,
      approvals: true,
      approveAlways: true,
      plans: true,
      rawToolIO: true,
      modelSwitching: true,
      sessionModes: true,
      config: false,
      observationalMemory: true,
      systemPromptInspection: true,
    },
  });
}

export function runtimeAcpFactory(options: RuntimeAcpAgentOptions): RuntimeFactory {
  const factory = options.runtime?.factory;
  if (!factory) throw new Error("Runtime ACP agent requires runtime.factory.");
  return factory;
}

export function runtimeAcpDescriptor(options: RuntimeAcpAgentOptions): RuntimeDescriptor {
  return options.runtime?.descriptor ?? runtimeAcpFactory(options).descriptor;
}

export function runtimeAcpAuthProfile(
  options: RuntimeAcpAgentOptions,
): RuntimeAuthProfile | undefined {
  return options.runtime?.auth ?? runtimeAcpFactory(options).auth;
}

function runtimeDescriptor(options: RuntimeAcpAgentOptions): RuntimeDescriptor {
  return runtimeAcpDescriptor(options);
}

function runtimeAuthProfile(options: RuntimeAcpAgentOptions): RuntimeAuthProfile | undefined {
  return runtimeAcpAuthProfile(options);
}

function runtimeAuthDescriptor(options: RuntimeAcpAgentOptions): RuntimeAuthDescriptor {
  return (
    runtimeAuthProfile(options)?.descriptor ??
    createRuntimeAuthDescriptor({ source: "none", methods: [] })
  );
}

function modeState(descriptor: RuntimeDescriptor): NonNullable<NewSessionResponse["modes"]> {
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

export { createRuntimeAcpAgent as createPeaAcpAgent, RuntimeAcpAgent as PeaAcpAgent };
