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
  peWorkbenchLoadThreadMethod,
  peWorkbenchMetadata,
  peWorkbenchQueueMessageMethod,
  peWorkbenchSetAccessLevelMethod,
  peWorkbenchSetModelMethod,
  type WorkbenchAccessLevel,
  type WorkbenchLoadThreadSnapshotRequest,
  type WorkbenchLoadThreadSnapshotResponse,
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
import type {
  RuntimeAccessLevel,
  RuntimeDescriptor,
  RuntimeFactory,
  RuntimeHandleHarness,
  RuntimeHandleServices,
  RuntimeSessionControls,
} from "../runtime.ts";
import { createRuntimePrompt, type RuntimePrompt } from "../prompts.ts";
import type { RuntimeProtocolSessions } from "../session/protocol-sessions.ts";
import {
  RuntimeAcpSessionStore,
  type AcpSession,
  type RuntimeAcpSessionUpdateSink,
} from "./acp-session-store.ts";
import { z } from "zod";

export interface RuntimeAcpRuntimeOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  factory: RuntimeFactory<TState, TServices, THarness>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
}

export interface RuntimeAcpSessionOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  manager?: RuntimeProtocolSessions<TState, TServices, THarness>;
}

export interface RuntimeAcpAgentOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  runtime?: RuntimeAcpRuntimeOptions<TState, TServices, THarness>;
  sessions?: RuntimeAcpSessionOptions<TState, TServices, THarness>;
}

export interface RuntimeAcpAgentSessionStore<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  createSession(request: {
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession<TState, TServices, THarness>>;
  prompt(sessionId: SessionId, prompt: RuntimePrompt): Promise<"end_turn" | "cancelled">;
  queueMessage(
    sessionId: SessionId,
    prompt: RuntimePrompt,
  ): Promise<{ queued: boolean; stopReason?: "end_turn" | "cancelled" }>;
  readControls(sessionId: SessionId): RuntimeSessionControls;
  setModel(sessionId: SessionId, modelId: string): Promise<RuntimeSessionControls>;
  setAccessLevel(
    sessionId: SessionId,
    accessLevel: RuntimeAccessLevel,
  ): Promise<RuntimeSessionControls>;
  readWorkbenchLoadThreadSnapshot(
    request: WorkbenchLoadThreadSnapshotRequest,
  ): Promise<WorkbenchLoadThreadSnapshotResponse>;
  cancel(sessionId: SessionId): void;
  resume(request: {
    sessionId: SessionId;
    cwd?: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession<TState, TServices, THarness>>;
  load(request: {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession<TState, TServices, THarness>>;
  fork(request: {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession<TState, TServices, THarness>>;
  list(cwd?: string | null): Promise<NonNullable<ListSessionsResponse["sessions"]>>;
  delete(sessionId: SessionId): Promise<void>;
  close(sessionId: SessionId): Promise<void>;
  closeAll?(): Promise<void>;
  configureClient?(clientCapabilities: ClientCapabilities | undefined): void;
}

export function createRuntimeAcpAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
>(
  updateSink: RuntimeAcpSessionUpdateSink,
  options: RuntimeAcpAgentOptions<TState, TServices, THarness>,
): Agent {
  return new RuntimeAcpAgent(options, new RuntimeAcpSessionStore(updateSink, options));
}

export class RuntimeAcpAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> implements Agent {
  constructor(
    private readonly options: RuntimeAcpAgentOptions<TState, TServices, THarness>,
    private readonly sessions: RuntimeAcpAgentSessionStore<TState, TServices, THarness>,
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

  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === peWorkbenchLoadThreadMethod) {
      const sessionId = readSessionId(params, "Load thread snapshot");
      const snapshot = await this.sessions.readWorkbenchLoadThreadSnapshot({
        sessionId,
        ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
        ...(Array.isArray(params.additionalDirectories)
          ? {
              additionalDirectories: params.additionalDirectories.filter(
                (entry): entry is string => typeof entry === "string",
              ),
            }
          : {}),
      });
      return workbenchLoadThreadSnapshotRecord(snapshot);
    }

    if (method === peWorkbenchQueueMessageMethod) {
      const sessionId = readSessionId(params, "Queue message");
      return this.sessions.queueMessage(sessionId, acpPrompt(readAcpPromptBlocks(params.prompt)));
    }

    if (method === peWorkbenchSetModelMethod) {
      const sessionId = readSessionId(params, "Set model");
      const modelId = typeof params.modelId === "string" ? params.modelId : undefined;
      if (!modelId) throw new Error("Set model requires modelId.");
      return runtimeControlsResponse(await this.sessions.setModel(sessionId, modelId));
    }

    if (method === peWorkbenchSetAccessLevelMethod) {
      const sessionId = readSessionId(params, "Set access level");
      const accessLevel = readRuntimeAccessLevel(params.accessLevel);
      if (!accessLevel) throw new Error("Set access level requires accessLevel.");
      return runtimeControlsResponse(await this.sessions.setAccessLevel(sessionId, accessLevel));
    }

    return {};
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
          return unsupportedAcpContentBlock(block);
      }
    }),
  );
}

function unsupportedAcpContentBlock(block: never): { text: string } {
  throw new Error(`Unsupported ACP content block: ${JSON.stringify(block)}`);
}

export function runtimeAcpWorkbenchExtension<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(options: RuntimeAcpAgentOptions<TState, TServices, THarness>): PeWorkbenchExtension {
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
      historySnapshots: true,
      toolCalls: true,
      approvals: true,
      approveAlways: true,
      plans: true,
      rawToolIO: true,
      modelSwitching: true,
      sessionModes: true,
      accessLevels: true,
      config: false,
      observationalMemory: true,
      systemPromptInspection: true,
    },
  });
}

export function runtimeAcpFactory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(
  options: RuntimeAcpAgentOptions<TState, TServices, THarness>,
): RuntimeFactory<TState, TServices, THarness> {
  const factory = options.runtime?.factory;
  if (!factory) throw new Error("Runtime ACP agent requires runtime.factory.");
  return factory;
}

export function runtimeAcpDescriptor<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(options: RuntimeAcpAgentOptions<TState, TServices, THarness>): RuntimeDescriptor {
  return options.runtime?.descriptor ?? runtimeAcpFactory(options).descriptor;
}

export function runtimeAcpAuthProfile<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(options: RuntimeAcpAgentOptions<TState, TServices, THarness>): RuntimeAuthProfile | undefined {
  return options.runtime?.auth ?? runtimeAcpFactory(options).auth;
}

function runtimeDescriptor<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(options: RuntimeAcpAgentOptions<TState, TServices, THarness>): RuntimeDescriptor {
  return runtimeAcpDescriptor(options);
}

function runtimeAuthProfile<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(options: RuntimeAcpAgentOptions<TState, TServices, THarness>): RuntimeAuthProfile | undefined {
  return runtimeAcpAuthProfile(options);
}

function runtimeAuthDescriptor<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(options: RuntimeAcpAgentOptions<TState, TServices, THarness>): RuntimeAuthDescriptor {
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

function workbenchLoadThreadSnapshotRecord(
  response: WorkbenchLoadThreadSnapshotResponse,
): Record<string, unknown> {
  return {
    session: response.session,
    messages: response.messages,
    ...(response.events ? { events: response.events } : {}),
  };
}

const acpMetaSchema = z.record(z.string(), z.unknown());
const acpTextBlockSchema = z
  .object({ type: z.literal("text"), text: z.string(), _meta: acpMetaSchema.optional() })
  .passthrough();
const acpMediaBlockSchema = z
  .object({
    type: z.union([z.literal("image"), z.literal("audio")]),
    data: z.string(),
    mimeType: z.string(),
    _meta: acpMetaSchema.optional(),
  })
  .passthrough();
const acpResourceLinkBlockSchema = z
  .object({
    type: z.literal("resource_link"),
    name: z.string(),
    uri: z.string(),
    mimeType: z.string().optional(),
    title: z.string().optional(),
    _meta: acpMetaSchema.optional(),
  })
  .passthrough();
const acpResourceBlockSchema = z
  .object({
    type: z.literal("resource"),
    resource: z
      .object({
        uri: z.string(),
        text: z.string().optional(),
        blob: z.string().optional(),
        mimeType: z.string().optional(),
      })
      .passthrough()
      .refine(
        (resource: { text?: string; blob?: string }) =>
          resource.text !== undefined || resource.blob !== undefined,
      ),
    _meta: acpMetaSchema.optional(),
  })
  .passthrough();
const acpContentBlockSchema = z.union([
  acpTextBlockSchema,
  acpMediaBlockSchema,
  acpResourceLinkBlockSchema,
  acpResourceBlockSchema,
]) as z.ZodType<PromptRequest["prompt"][number]>;
const acpPromptBlocksSchema = z.array(acpContentBlockSchema);

function readAcpPromptBlocks(value: unknown): PromptRequest["prompt"] {
  const prompt = acpPromptBlocksSchema.safeParse(value);
  if (prompt.success) return prompt.data;
  throw new Error("Queue message requires valid prompt blocks.");
}

function readSessionId(params: Record<string, unknown>, action: string): SessionId {
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
  if (!sessionId) throw new Error(`${action} requires sessionId.`);
  return sessionId;
}

const runtimeAccessLevelSchema = z.enum(["read-only", "ask", "trusted"]);

function readRuntimeAccessLevel(value: unknown): RuntimeAccessLevel | undefined {
  const accessLevel = runtimeAccessLevelSchema.safeParse(value);
  return accessLevel.success ? accessLevel.data : undefined;
}

function runtimeControlsResponse(controls: RuntimeSessionControls): Record<string, unknown> {
  return {
    ...(controls.currentModelId ? { currentModelId: controls.currentModelId } : {}),
    accessLevel: controls.accessLevel,
    accessLevels: runtimeAccessLevels(),
  };
}

function runtimeAccessLevels(): Array<{
  id: WorkbenchAccessLevel;
  name: string;
  description: string;
}> {
  return [
    {
      id: "read-only",
      name: "Read-only",
      description: "Ask before tools and avoid mutation-oriented work.",
    },
    {
      id: "ask",
      name: "Ask",
      description: "Ask before privileged tools.",
    },
    {
      id: "trusted",
      name: "Trusted",
      description: "Auto-approve runtime tool calls.",
    },
  ];
}
