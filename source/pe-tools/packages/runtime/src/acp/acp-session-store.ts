import type {
  ClientCapabilities,
  SessionId,
  SessionInfo,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type { RuntimeEvent } from "../events.ts";
import type { RuntimeFactory, RuntimeDescriptor } from "../runtime.ts";
import type { RuntimePrompt } from "../prompts.ts";
import {
  RuntimeProtocolSessions,
  type RuntimeProtocolSession,
} from "../session/protocol-sessions.ts";
import { defaultRuntimeSessionRegistryPath } from "../session/session-registry.ts";
import { RuntimeAcpClient, type RuntimeAcpClientTransport } from "./runtime-client.ts";
import { RuntimeToAcpEvents } from "./events-map-runtime-acp.ts";

export interface RuntimeAcpSessionStoreRuntimeOptions {
  factory: RuntimeFactory;
  descriptor?: RuntimeDescriptor;
}

export interface RuntimeAcpSessionStoreSessionOptions {
  manager?: RuntimeProtocolSessions;
  registryPath?: string | null;
}

export interface RuntimeAcpSessionStoreOptions {
  runtime?: RuntimeAcpSessionStoreRuntimeOptions;
  sessions?: RuntimeAcpSessionStoreSessionOptions;
}

export interface RuntimeAcpCreateSessionRequest {
  cwd: string;
  additionalDirectories?: string[];
}

export interface RuntimeAcpSessionUpdateSink {
  sessionUpdate(params: { sessionId: SessionId; update: SessionUpdate }): Promise<void> | void;
}

export interface RuntimeAcpSessionClient
  extends RuntimeAcpSessionUpdateSink, RuntimeAcpClientTransport {}

export type AcpSession = RuntimeProtocolSession & {
  mapper: RuntimeToAcpEvents;
};

export type PeaAcpSessionStoreOptions = RuntimeAcpSessionStoreOptions;
export type PeaAcpCreateSessionRequest = RuntimeAcpCreateSessionRequest;
export type PeaAcpSessionUpdateSink = RuntimeAcpSessionUpdateSink;
export type PeaAcpSessionClient = RuntimeAcpSessionClient;

export class RuntimeAcpSessionStore {
  private readonly runtimeSessions: RuntimeProtocolSessions;
  private readonly mappers = new Map<SessionId, RuntimeToAcpEvents>();
  private readonly client: RuntimeAcpClient;
  private readonly requestedPermissionToolIds = new Set<string>();

  constructor(
    private readonly updateSink: RuntimeAcpSessionUpdateSink,
    private readonly options: RuntimeAcpSessionStoreOptions,
    clientTransport: RuntimeAcpClientTransport = updateSink as RuntimeAcpClientTransport,
  ) {
    this.client = new RuntimeAcpClient(clientTransport);
    this.runtimeSessions =
      options.sessions?.manager ??
      new RuntimeProtocolSessions({
        factory: runtimeFactory(options),
        idPrefix: "runtime-acp",
        sessionRegistryPath: acpSessionRegistryPath(options),
      });
  }

  configureClient(clientCapabilities: ClientCapabilities | undefined): void {
    this.client.configure(clientCapabilities);
  }

  async createSession(request: RuntimeAcpCreateSessionRequest): Promise<AcpSession> {
    const descriptor = runtimeDescriptor(this.options);
    const session = await this.runtimeSessions.createSession({
      protocol: "acp",
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      title: `ACP ${descriptor.modeName}`,
    });
    return this.attachSession(session);
  }

  getSession(id: SessionId): AcpSession {
    const session = this.runtimeSessions.getSession(id);
    const mapper = this.mappers.get(id);
    if (!mapper) throw new Error(`Unknown ACP session: ${id}`);
    return Object.assign(session, { mapper });
  }

  async prompt(sessionId: SessionId, prompt: RuntimePrompt): Promise<"end_turn" | "cancelled"> {
    return this.runtimeSessions.sendPrompt(sessionId, prompt);
  }

  cancel(sessionId: SessionId): void {
    this.runtimeSessions.cancel(sessionId);
  }

  async resume(request: {
    sessionId: SessionId;
    cwd?: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession> {
    const session = await this.runtimeSessions.resumeSession(request.sessionId, {
      protocol: "acp",
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
    });
    let mapper = this.mappers.get(request.sessionId);
    if (!mapper) {
      this.attachSession(session);
    }
    return Object.assign(session, { mapper: this.mappers.get(session.id)! });
  }

  async load(request: {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession> {
    const session = await this.resume(request);
    await this.replayHistory(session.id);
    return session;
  }

  async fork(request: {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: string[];
  }): Promise<AcpSession> {
    const session = await this.runtimeSessions.forkSession(request.sessionId, {
      protocol: "acp",
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
    });
    return this.attachSession(session);
  }

  list(cwd?: string | null): SessionInfo[] {
    return this.runtimeSessions.listSessions({ protocol: "acp", cwd }).map(
      (session): SessionInfo => ({
        sessionId: session.id,
        cwd: session.cwd,
        additionalDirectories: session.additionalDirectories,
        title: session.title,
        updatedAt: session.updatedAt,
      }),
    );
  }

  async delete(sessionId: SessionId): Promise<void> {
    await this.runtimeSessions.delete(sessionId);
    this.mappers.delete(sessionId);
  }

  async close(sessionId: SessionId): Promise<void> {
    await this.runtimeSessions.close(sessionId);
    this.mappers.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    await this.runtimeSessions.closeAll();
    this.mappers.clear();
    this.requestedPermissionToolIds.clear();
  }

  private handleRuntimeEvent(
    session: RuntimeProtocolSession,
    mapper: RuntimeToAcpEvents,
    event: RuntimeEvent,
  ): void {
    for (const update of mapper.translate(event)) {
      this.runtimeSessions.enqueue(session.id, () => this.publishSessionUpdate(session.id, update));
    }

    if (event.type === "tool_started" && event.status === "pending_approval") {
      this.enqueuePermissionRequest(session, event);
    }
  }

  private attachSession(session: RuntimeProtocolSession): AcpSession {
    const existing = this.mappers.get(session.id);
    if (existing) return Object.assign(session, { mapper: existing });

    const mapper = new RuntimeToAcpEvents();
    this.mappers.set(session.id, mapper);
    session.unsubscribe = this.runtimeSessions.subscribe(session.id, (event) =>
      this.handleRuntimeEvent(session, mapper, event),
    );
    return Object.assign(session, { mapper });
  }

  private enqueuePermissionRequest(
    session: RuntimeProtocolSession,
    event: Extract<RuntimeEvent, { type: "tool_started" }>,
  ): void {
    const key = `${session.id}:${event.toolCallId}`;
    if (this.requestedPermissionToolIds.has(key)) return;
    this.requestedPermissionToolIds.add(key);

    this.runtimeSessions.enqueue(session.id, async () => {
      const outcome = await this.client.requestPermission({
        sessionId: session.id,
        toolCall: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          title: event.title,
          input: event.input,
          tool: event.tool,
        },
      });
      await this.publishSessionUpdate(session.id, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "pending",
        rawOutput: {
          permissionOutcome: outcome,
          resumeDecisionRecorded: true,
        },
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: permissionOutcomeText(outcome),
            },
          },
        ],
      });
      this.runtimeSessions.recordResumeDecision(session.id, {
        interruptId: `tool-approval:${event.toolCallId}`,
        status: outcome.outcome === "selected" ? "resolved" : "cancelled",
        payload: outcome.outcome === "selected" ? { optionId: outcome.optionId } : undefined,
      });
    });
  }

  private async replayHistory(sessionId: SessionId): Promise<void> {
    const history = this.runtimeSessions.history(sessionId);
    for (const entry of history) {
      if (entry.type === "prompt") {
        await this.publishSessionUpdate(
          sessionId,
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: entry.content },
          },
          { record: false },
        );
        continue;
      }
      if (entry.type === "protocol_event" && entry.protocol === "acp") {
        await this.publishSessionUpdate(sessionId, entry.payload as SessionUpdate, {
          record: false,
        });
      }
    }
  }

  private async publishSessionUpdate(
    sessionId: SessionId,
    update: SessionUpdate,
    options: { record?: boolean } = {},
  ): Promise<void> {
    if (options.record !== false)
      this.runtimeSessions.recordProtocolEvent(sessionId, "acp", update);
    await this.updateSink.sessionUpdate({ sessionId, update });
  }
}

function runtimeFactory(options: RuntimeAcpSessionStoreOptions): RuntimeFactory {
  const factory = options.runtime?.factory;
  if (!factory) throw new Error("Runtime ACP session store requires runtime.factory.");
  return factory;
}

function runtimeDescriptor(options: RuntimeAcpSessionStoreOptions): RuntimeDescriptor {
  return options.runtime?.descriptor ?? runtimeFactory(options).descriptor;
}

function acpSessionRegistryPath(options: RuntimeAcpSessionStoreOptions): string | null {
  const registryPath = options.sessions?.registryPath;
  if (registryPath === null) return null;
  return (
    registryPath ??
    defaultRuntimeSessionRegistryPath({
      runtimeId: runtimeDescriptor(options).id,
      protocol: "acp",
    })
  );
}

function permissionOutcomeText(
  outcome: Awaited<ReturnType<RuntimeAcpClient["requestPermission"]>>,
): string {
  return outcome.outcome === "selected"
    ? `ACP permission selected: ${outcome.optionId}. The decision was recorded for runtime continuation.`
    : "ACP permission cancelled. The decision was recorded for runtime continuation.";
}

export { RuntimeAcpSessionStore as PeaAcpSessionStore };
