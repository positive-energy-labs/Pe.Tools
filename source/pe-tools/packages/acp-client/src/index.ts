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
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import {
  createPeWorkbenchExtension,
  deriveWorkbenchCapabilities,
  peWorkbenchMetadata,
  readPeWorkbenchExtension,
  type WorkbenchAgentClient,
  type WorkbenchAgentInfo,
  type WorkbenchApprovalOption,
  type WorkbenchEvent,
  type WorkbenchEventHandler,
  type WorkbenchJsonObject,
  type WorkbenchLoadThreadRequest,
  type WorkbenchNewSessionRequest,
  type WorkbenchPromptRequest,
  type WorkbenchPromptResult,
  type WorkbenchSessionInfo,
  type WorkbenchThreadInfo,
} from "@pe/agent-contracts";
import { acpSessionUpdateToWorkbenchEvents } from "@pe/agent-projection";

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

type AcpAgentConnection = Agent & {
  closed: Promise<void>;
  signal: AbortSignal;
};

export class AcpWorkbenchClient implements Client, WorkbenchAgentClient {
  private readonly handlers = new Set<WorkbenchEventHandler>();
  private readonly pendingPermissions = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();
  private connection: AcpAgentConnection | null = null;
  private closeConnection: (() => Promise<void> | void) | undefined;
  private currentSessionId: string | undefined;

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
      response?.sessions?.map(
        (session): WorkbenchThreadInfo => ({
          threadId: session.sessionId,
          sessionId: session.sessionId,
          title: session.title ?? undefined,
          cwd,
          updatedAt: session.updatedAt ?? undefined,
          metadata: recordMetadata(session._meta),
        }),
      ) ?? [];
    this.emit({ type: "threads_replaced", threads });
    return threads;
  }

  async loadThread(request: WorkbenchLoadThreadRequest): Promise<WorkbenchSessionInfo> {
    const loadSession = this.agent.loadSession?.bind(this.agent);
    if (!loadSession) throw new Error("ACP agent does not support loading session history.");

    const session: WorkbenchSessionInfo = {
      sessionId: request.threadId,
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

    const response = await loadSession({
      sessionId: request.threadId,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      mcpServers: [],
    });
    this.emitModeState(response.modes);
    return session;
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

  async cancel(sessionId: string): Promise<void> {
    await this.agent.cancel({ sessionId });
    this.emit({ type: "run_status_changed", status: "idle", timestamp: new Date().toISOString() });
  }

  setModel(modelId: string): void {
    this.emit({
      type: "debug_event_recorded",
      debugEvent: {
        id: `workbench:model:${modelId}`,
        source: "workbench",
        type: "model_set_local",
        label: "Model selection updated locally; ACP provider mapping is not defined yet.",
        payload: { modelId },
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
    if (!isRecord(modes)) return;
    const currentModeId = typeof modes.currentModeId === "string" ? modes.currentModeId : undefined;
    const availableModes = Array.isArray(modes.availableModes)
      ? modes.availableModes.flatMap((mode) => {
          if (!isRecord(mode) || typeof mode.id !== "string" || typeof mode.name !== "string")
            return [];
          return [
            {
              id: mode.id,
              name: mode.name,
              description: typeof mode.description === "string" ? mode.description : undefined,
              metadata: recordMetadata(mode._meta),
            },
          ];
        })
      : undefined;

    this.emit({
      type: "session_mode_updated",
      sessionMode: {
        currentModeId,
        availableModes,
      },
    });
  }

  private get agent(): Agent {
    if (!this.connection) throw new Error("ACP workbench client is not connected.");
    return this.connection;
  }

  private emit(event: WorkbenchEvent): void {
    for (const handler of this.handlers) handler(event);
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
  return client.connect(connection);
}

export function createStdioAcpWorkbenchClient(
  options: AcpStdioWorkbenchClientOptions,
): AcpWorkbenchClient {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  const client = new AcpWorkbenchClient(options);
  const connection = new ClientSideConnection(() => client, stream);
  return client.connect(connection, () => {
    child.kill();
  });
}

function createLinkedStreams(): { client: Stream; agent: Stream } {
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
  };
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

function recordMetadata(value: unknown): WorkbenchJsonObject | undefined {
  if (!isRecord(value)) return undefined;
  return value as WorkbenchJsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
