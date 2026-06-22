import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type ClientCapabilities,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type CancelNotification,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import {
  createPeWorkbenchExtension,
  deriveWorkbenchCapabilities,
  peWorkbenchLoadThreadMethod,
  peWorkbenchMetadata,
  peWorkbenchQueueMessageMethod,
  peWorkbenchRawThreadMethod,
  peWorkbenchSetAccessLevelMethod,
  peWorkbenchSetModelMethod,
  type PeWorkbenchExtension,
  readPeWorkbenchExtension,
  readPeWorkbenchSessionMetadata,
  readStopReason,
  readWorkbenchJsonObject,
  readWorkbenchLoadThreadResponse,
  readWorkbenchRawThreadSnapshot,
  type WorkbenchAccessLevel,
  type WorkbenchAccessLevelInfo,
  type WorkbenchAgentClient,
  type WorkbenchAgentInfo,
  type WorkbenchApprovalOption,
  type WorkbenchEvent,
  type WorkbenchEventHandler,
  type WorkbenchJsonObject,
  type WorkbenchLoadThreadRequest,
  type WorkbenchLoadThreadResponse,
  type WorkbenchNewSessionRequest,
  type WorkbenchPromptRequest,
  type WorkbenchPromptResult,
  type WorkbenchQueueMessageRequest,
  type WorkbenchQueueMessageResult,
  type WorkbenchRawThreadRequest,
  type WorkbenchRawThreadSnapshot,
  type WorkbenchSessionInfo,
  type WorkbenchState,
  type WorkbenchThreadInfo,
} from "@pe/agent-contracts";
import {
  acpSessionUpdateToWorkbenchEvents,
  applyWorkbenchEvent,
  createWorkbenchState,
} from "@pe/agent-contracts";
import { z } from "zod";

export interface AcpWorkbenchClientOptions {
  clientName?: string;
  clientVersion?: string;
}

export interface AcpStdioWorkbenchClientOptions extends AcpWorkbenchClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type AcpAgentConnection = {
  closed: Promise<void>;
  signal: AbortSignal;
  initialize(params: InitializeRequest): Promise<InitializeResponse>;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  cancel(params: CancelNotification): Promise<void>;
  listSessions?(params: ListSessionsRequest): Promise<ListSessionsResponse>;
  loadSession?(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  setSessionMode?(params: SetSessionModeRequest): Promise<SetSessionModeResponse>;
  extMethod?(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
};

interface LoadReplayCapture {
  sessionId: string;
  state: WorkbenchState;
}

export class AcpWorkbenchClient implements Client, WorkbenchAgentClient {
  private readonly handlers = new Set<WorkbenchEventHandler>();
  private readonly pendingPermissions = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();
  private connection: AcpAgentConnection | null = null;
  private closeConnection: (() => Promise<void> | void) | undefined;
  private currentSessionId: string | undefined;
  private loadReplayCapture: LoadReplayCapture | undefined;
  private peWorkbenchExtension: PeWorkbenchExtension | undefined;

  constructor(private readonly options: AcpWorkbenchClientOptions = {}) {}

  connect(connection: AcpAgentConnection, closeConnection?: () => Promise<void> | void): this {
    this.connection = connection;
    this.closeConnection = closeConnection;
    return this;
  }

  subscribe(handler: WorkbenchEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async initialize(): Promise<WorkbenchAgentInfo> {
    const response = await this.agent.initialize({
      protocolVersion: 1,
      clientInfo: {
        name: this.options.clientName ?? "Pe.Tools Workbench",
        title: this.options.clientName ?? "Pe.Tools Workbench",
        version: this.options.clientVersion ?? "0.1.0",
      },
      clientCapabilities: clientCapabilities(),
    });
    const extension =
      readPeWorkbenchExtension(response._meta) ??
      readPeWorkbenchExtension(response.agentCapabilities?._meta);
    this.peWorkbenchExtension = extension;
    const capabilities = deriveWorkbenchCapabilities(response.agentCapabilities, extension);
    const info: WorkbenchAgentInfo = {
      name: response.agentInfo?.name ?? extension?.runtime?.name ?? "ACP Agent",
      title: response.agentInfo?.title ?? extension?.runtime?.title,
      version: response.agentInfo?.version ?? undefined,
      runtime: extension?.runtime,
      capabilities,
      metadata: recordMetadata(response._meta),
    };
    this.emit({ type: "agent_initialized", agent: info });
    return info;
  }

  async newSession(request: WorkbenchNewSessionRequest): Promise<WorkbenchSessionInfo> {
    const response = await this.agent.newSession({
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      mcpServers: [],
    });
    const session: WorkbenchSessionInfo = {
      sessionId: response.sessionId,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories ?? [],
    };
    this.currentSessionId = session.sessionId;
    this.emit({ type: "session_started", session });
    this.emitModeState(response.modes);
    return session;
  }

  async listThreads(cwd?: string): Promise<WorkbenchThreadInfo[]> {
    const response = await this.agent.listSessions?.({ cwd });
    const threads =
      response?.sessions?.map((session): WorkbenchThreadInfo => {
        const metadata = recordMetadata(session._meta);
        const peSession = readPeWorkbenchSessionMetadata(metadata);
        return {
          threadId: peSession?.threadId ?? session.sessionId,
          sessionId: session.sessionId,
          resourceId: peSession?.resourceId,
          title: session.title ?? undefined,
          cwd,
          updatedAt: session.updatedAt ?? undefined,
          lock: peSession?.lock,
          metadata,
        };
      }) ?? [];
    this.emit({ type: "threads_replaced", threads });
    return threads;
  }

  async loadThread(
    request: WorkbenchLoadThreadRequest,
  ): Promise<WorkbenchSessionInfo | WorkbenchLoadThreadResponse> {
    const acpSessionId = request.sessionId ?? request.threadId;
    const session: WorkbenchSessionInfo = {
      sessionId: acpSessionId,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories ?? [],
    };
    this.currentSessionId = session.sessionId;
    this.emit({ type: "approvals_cleared", reason: "thread_loaded" });
    this.emit({
      type: "session_started",
      session,
      thread: { threadId: request.threadId, sessionId: session.sessionId },
    });

    const snapshot = await this.readWorkbenchLoadThreadSnapshot(acpSessionId, request);
    if (snapshot) return snapshot;

    const loadSession = this.agent.loadSession?.bind(this.agent);
    if (!loadSession) throw new Error("ACP agent does not support loading session history.");

    const capture: LoadReplayCapture = { sessionId: acpSessionId, state: createWorkbenchState() };
    this.loadReplayCapture = capture;
    const response = await (async () => {
      try {
        return await loadSession({
          sessionId: acpSessionId,
          cwd: request.cwd,
          additionalDirectories: request.additionalDirectories,
          mcpServers: [],
        });
      } finally {
        if (this.loadReplayCapture === capture) this.loadReplayCapture = undefined;
      }
    })();
    this.emitModeState(response.modes);

    const messages = capture.state.transcript.messages;
    return messages.length > 0 ? { session, messages } : session;
  }

  async rawThread(request: WorkbenchRawThreadRequest): Promise<WorkbenchRawThreadSnapshot> {
    const extMethod = this.agent.extMethod?.bind(this.agent);
    if (!extMethod || this.peWorkbenchExtension?.capabilities.rawThreadSnapshots !== true) {
      throw new Error("ACP agent does not support raw thread snapshots.");
    }

    const response = await extMethod(peWorkbenchRawThreadMethod, {
      threadId: request.threadId,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
    });
    const snapshot = readWorkbenchRawThreadSnapshot(response);
    if (!snapshot) throw new Error("ACP agent returned an invalid raw thread snapshot.");
    return snapshot;
  }

  async sendPrompt(request: WorkbenchPromptRequest): Promise<WorkbenchPromptResult> {
    this.emit({
      type: "run_status_changed",
      status: "running",
      timestamp: new Date().toISOString(),
    });
    const response = await this.agent.prompt({
      sessionId: request.sessionId,
      prompt: [{ type: "text", text: request.text }],
    });
    this.emit({
      type: "run_status_changed",
      status: "idle",
      stopReason: response.stopReason,
      timestamp: new Date().toISOString(),
    });
    return { stopReason: response.stopReason };
  }

  async queueMessage(request: WorkbenchQueueMessageRequest): Promise<WorkbenchQueueMessageResult> {
    const queue = this.agent.extMethod?.bind(this.agent);
    if (!queue) {
      const result = await this.sendPrompt(request);
      return { accepted: true, queued: false, stopReason: result.stopReason };
    }

    const response = await queue(peWorkbenchQueueMessageMethod, {
      sessionId: request.sessionId,
      prompt: [{ type: "text", text: request.text }],
    });
    const stopReason = readStopReason(response.stopReason);
    return {
      accepted: true,
      queued: response.queued === true,
      ...(stopReason ? { stopReason } : {}),
    };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.agent.cancel({ sessionId });
    this.emit({ type: "run_status_changed", status: "idle", timestamp: new Date().toISOString() });
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.currentSessionId) throw new Error("Cannot set model before a session exists.");
    const extMethod = this.agent.extMethod?.bind(this.agent);
    if (!extMethod) throw new Error("ACP agent does not support model selection.");
    const response = await extMethod(peWorkbenchSetModelMethod, {
      sessionId: this.currentSessionId,
      modelId,
    });
    const currentModelId =
      typeof response.currentModelId === "string" ? response.currentModelId : modelId;
    this.emit({
      type: "model_state_updated",
      model: { currentModelId },
    });
  }

  async setAccessLevel(accessLevel: WorkbenchAccessLevel): Promise<void> {
    if (!this.currentSessionId) throw new Error("Cannot set access level before a session exists.");
    const extMethod = this.agent.extMethod?.bind(this.agent);
    if (!extMethod) throw new Error("ACP agent does not support access level selection.");
    const response = await extMethod(peWorkbenchSetAccessLevelMethod, {
      sessionId: this.currentSessionId,
      accessLevel,
    });
    const currentAccessLevel = readAccessLevel(response.accessLevel) ?? accessLevel;
    this.emit({
      type: "access_level_updated",
      access: {
        currentAccessLevel,
        availableAccessLevels: readAccessLevels(response.accessLevels),
      },
    });
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.currentSessionId) throw new Error("Cannot set session mode before a session exists.");
    const setSessionMode = this.agent.setSessionMode?.bind(this.agent);
    if (!setSessionMode) throw new Error("ACP agent does not support session modes.");
    await setSessionMode({ sessionId: this.currentSessionId, modeId });
    this.emit({ type: "session_mode_updated", sessionMode: { currentModeId: modeId } });
  }

  resolveApproval(requestId: string, optionId?: string): void {
    const resolve = this.pendingPermissions.get(requestId);
    if (!resolve) return;

    this.pendingPermissions.delete(requestId);
    resolve({ outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
    this.emit({
      type: "approval_resolved",
      requestId,
      resolution: { optionId, resolvedAt: new Date().toISOString() },
    });
  }

  async close(): Promise<void> {
    for (const [requestId, resolve] of this.pendingPermissions) {
      resolve({ outcome: { outcome: "cancelled" } });
      this.emit({
        type: "approval_resolved",
        requestId,
        resolution: { resolvedAt: new Date().toISOString() },
      });
    }
    this.pendingPermissions.clear();
    await this.closeConnection?.();
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = `${params.sessionId}:${params.toolCall.toolCallId}`;
    const approval = {
      requestId,
      sessionId: params.sessionId,
      toolCall: {
        id: params.toolCall.toolCallId,
        title: params.toolCall.title ?? params.toolCall.toolCallId,
        kind: params.toolCall.kind ?? undefined,
        status: params.toolCall.status ?? "pending",
        rawInput: params.toolCall.rawInput,
        rawOutput: params.toolCall.rawOutput,
      },
      options: params.options.map(
        (option): WorkbenchApprovalOption => ({
          optionId: option.optionId,
          name: option.name,
          kind: option.kind,
        }),
      ),
      status: "pending" as const,
      defaultOptionId: params.options[0]?.optionId,
      createdAt: new Date().toISOString(),
    };

    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, resolve);
      this.emit({ type: "approval_requested", approval });
    });
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    for (const event of acpSessionUpdateToWorkbenchEvents(params.sessionId, params.update)) {
      this.captureLoadReplayEvent(params.sessionId, event);
      this.emit(event);
    }
  }

  async extMethod(
    _method: string,
    _params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return {};
  }

  async extNotification(_method: string, _params: Record<string, unknown>): Promise<void> {}

  private emitModeState(modes: unknown): void {
    const modeState = readModeState(modes);
    if (!modeState) return;
    this.emit({
      type: "session_mode_updated",
      sessionMode: modeState,
    });
  }

  private get agent(): AcpAgentConnection {
    if (!this.connection) throw new Error("ACP workbench client is not connected.");
    return this.connection;
  }

  private emit(event: WorkbenchEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  private captureLoadReplayEvent(sessionId: string, event: WorkbenchEvent): void {
    if (this.loadReplayCapture?.sessionId !== sessionId) return;
    this.loadReplayCapture.state = applyWorkbenchEvent(this.loadReplayCapture.state, event);
  }

  private async readWorkbenchLoadThreadSnapshot(
    sessionId: string,
    request: WorkbenchLoadThreadRequest,
  ): Promise<WorkbenchLoadThreadResponse | undefined> {
    if (this.peWorkbenchExtension?.capabilities.historySnapshots !== true) return undefined;
    const extMethod = this.agent.extMethod?.bind(this.agent);
    if (!extMethod) return undefined;

    let response: unknown;
    try {
      response = await extMethod(peWorkbenchLoadThreadMethod, {
        sessionId,
        cwd: request.cwd,
        additionalDirectories: request.additionalDirectories,
      });
    } catch (error) {
      if (this.peWorkbenchExtension) throw error;
      return undefined;
    }

    return readWorkbenchLoadThreadResponse(response);
  }
}

export function createInProcessAcpWorkbenchClient(
  toAgent: (connection: AgentSideConnection) => Agent,
  options: AcpWorkbenchClientOptions = {},
): AcpWorkbenchClient {
  const streams = createLinkedStreams();
  const client = new AcpWorkbenchClient(options);
  const connection = new ClientSideConnection(() => client, streams.client);
  new AgentSideConnection(toAgent, streams.agent);
  return client.connect(connection, streams.close);
}

export function createStdioAcpWorkbenchClient(
  options: AcpStdioWorkbenchClientOptions,
): AcpWorkbenchClient {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const stream = ndJsonStream(nodeWritableBytes(child.stdin), nodeReadableBytes(child.stdout));
  const client = new AcpWorkbenchClient(options);
  const connection = new ClientSideConnection(() => client, stream);
  return client.connect(connection, () => {
    child.kill();
  });
}

function createLinkedStreams(): { client: Stream; agent: Stream; close: () => Promise<void> } {
  const clientToAgent = new TransformStream<unknown>();
  const agentToClient = new TransformStream<unknown>();
  return {
    client: {
      readable: agentToClient.readable,
      writable: clientToAgent.writable,
    },
    agent: {
      readable: clientToAgent.readable,
      writable: agentToClient.writable,
    },
    close: async () => {
      await Promise.allSettled([
        closeWritableStream(clientToAgent.writable),
        closeWritableStream(agentToClient.writable),
      ]);
    },
  };
}

async function closeWritableStream(stream: WritableStream<unknown>): Promise<void> {
  const writer = stream.getWriter();
  try {
    await writer.close();
  } finally {
    writer.releaseLock();
  }
}

function nodeWritableBytes(stream: Writable): WritableStream<Uint8Array> {
  const writer = Writable.toWeb(stream).getWriter();
  return new WritableStream<Uint8Array>({
    write: (chunk) => writer.write(chunk),
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  });
}

function nodeReadableBytes(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      try {
        for await (const chunk of stream) {
          controller.enqueue(toUint8Array(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel: () => {
      stream.destroy();
    },
  });
}

function toUint8Array(chunk: unknown): Uint8Array<ArrayBuffer> {
  if (chunk instanceof Uint8Array) return copyBytes(chunk);
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return copyBytes(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  throw new Error("ACP stdio stream emitted a non-byte chunk.");
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function clientCapabilities(): ClientCapabilities {
  return {
    plan: {},
    _meta: peWorkbenchMetadata(
      createPeWorkbenchExtension({
        capabilities: {
          toolCalls: true,
          approvals: true,
          approveAlways: true,
          plans: true,
          rawToolIO: true,
        },
      }),
    ),
  };
}

const acpClientAccessLevelSchema = z.enum(["read-only", "ask", "trusted"]);
const acpClientAccessLevelInfoSchema = z
  .object({
    id: acpClientAccessLevelSchema,
    name: z.string(),
    description: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchAccessLevelInfo => ({
      id: value.id,
      name: value.name,
      description: value.description,
      metadata: recordMetadata(value.metadata),
    }),
  );
const acpClientModeInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    _meta: z.unknown().optional(),
  })
  .passthrough()
  .transform((value) => ({
    id: value.id,
    name: value.name,
    description: value.description,
    metadata: recordMetadata(value._meta),
  }));
const acpClientModeStateSchema = z
  .object({
    currentModeId: z.string().optional(),
    availableModes: z.array(acpClientModeInfoSchema).optional(),
  })
  .passthrough();

function recordMetadata(value: unknown): WorkbenchJsonObject | undefined {
  return readWorkbenchJsonObject(value);
}

function readModeState(value: unknown):
  | {
      currentModeId?: string;
      availableModes?: Array<z.output<typeof acpClientModeInfoSchema>>;
    }
  | undefined {
  const modeState = acpClientModeStateSchema.safeParse(value);
  return modeState.success ? modeState.data : undefined;
}

function readAccessLevels(value: unknown): WorkbenchAccessLevelInfo[] | undefined {
  const levels = z.array(acpClientAccessLevelInfoSchema).safeParse(value);
  return levels.success && levels.data.length ? levels.data : undefined;
}

function readAccessLevel(value: unknown): WorkbenchAccessLevel | undefined {
  const accessLevel = acpClientAccessLevelSchema.safeParse(value);
  return accessLevel.success ? accessLevel.data : undefined;
}
