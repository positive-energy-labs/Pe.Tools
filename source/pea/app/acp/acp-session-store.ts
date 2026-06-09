import type {
  ClientCapabilities,
  SessionId,
  SessionInfo,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type { PeaAgentOptions } from "../pea-runtime.js";
import type { PeaRuntimeEvent } from "../pea-runtime-events.js";
import {
  describePeaRuntime,
  resolvePeaRuntimeCreateRequest,
  type PeaRuntimeCreateRequest,
} from "../pea-runtime-factory.js";
import type { PeaRuntimePrompt } from "../pea-runtime-prompts.js";
import {
  PeaRuntimeProtocolSessions,
  type PeaRuntimeProtocolSession,
} from "../pea-runtime-protocol-sessions.js";
import { defaultPeaRuntimeSessionRegistryPath } from "../pea-runtime-session-registry.js";
import { PeaAcpRuntimeClient, type PeaAcpClientTransport } from "./pea-acp-runtime-client.js";
import { PeaRuntimeToAcpEvents } from "./pea-runtime-to-acp-events.js";

export type PeaAcpRuntimeId = "pea" | "dev-agent";

export interface PeaAcpSessionStoreOptions {
  runtime: PeaAcpRuntimeId;
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  modelId?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAgentOptions["authSource"];
  runtimeSessions?: PeaRuntimeProtocolSessions;
  sessionRegistryPath?: string | null;
}

export type PeaAcpRuntimeRequest = PeaRuntimeCreateRequest;

export function resolvePeaAcpRuntimeRequest(
  options: PeaAcpSessionStoreOptions,
  cwd: string,
): PeaAcpRuntimeRequest {
  return resolvePeaRuntimeCreateRequest(options, cwd);
}

export interface PeaAcpCreateSessionRequest {
  cwd: string;
  additionalDirectories?: string[];
}

export interface PeaAcpSessionUpdateSink {
  sessionUpdate(params: { sessionId: SessionId; update: SessionUpdate }): Promise<void> | void;
}

export interface PeaAcpSessionClient extends PeaAcpSessionUpdateSink, PeaAcpClientTransport {}

export type AcpSession = PeaRuntimeProtocolSession & {
  mapper: PeaRuntimeToAcpEvents;
};

export class PeaAcpSessionStore {
  private readonly runtimeSessions: PeaRuntimeProtocolSessions;
  private readonly mappers = new Map<SessionId, PeaRuntimeToAcpEvents>();
  private readonly client: PeaAcpRuntimeClient;
  private readonly requestedPermissionToolIds = new Set<string>();

  constructor(
    private readonly updateSink: PeaAcpSessionUpdateSink,
    private readonly options: PeaAcpSessionStoreOptions,
    clientTransport: PeaAcpClientTransport = updateSink as PeaAcpClientTransport,
  ) {
    this.client = new PeaAcpRuntimeClient(clientTransport);
    this.runtimeSessions =
      options.runtimeSessions ??
      new PeaRuntimeProtocolSessions({
        ...options,
        idPrefix: "pea-acp",
        sessionRegistryPath:
          options.sessionRegistryPath === null
            ? null
            : (options.sessionRegistryPath ??
              defaultPeaRuntimeSessionRegistryPath({
                runtimeId: options.runtime,
                protocol: "acp",
              })),
      });
  }

  configureClient(clientCapabilities: ClientCapabilities | undefined): void {
    this.client.configure(clientCapabilities);
  }

  async createSession(request: PeaAcpCreateSessionRequest): Promise<AcpSession> {
    const descriptor = describePeaRuntime(this.options.runtime);
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

  async prompt(sessionId: SessionId, prompt: PeaRuntimePrompt): Promise<"end_turn" | "cancelled"> {
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

  delete(sessionId: SessionId): void {
    this.runtimeSessions.delete(sessionId);
    this.mappers.delete(sessionId);
  }

  close(sessionId: SessionId): void {
    this.runtimeSessions.close(sessionId);
    this.mappers.delete(sessionId);
  }

  closeAll(): void {
    this.runtimeSessions.closeAll();
    this.mappers.clear();
    this.requestedPermissionToolIds.clear();
  }

  private handleRuntimeEvent(
    session: PeaRuntimeProtocolSession,
    mapper: PeaRuntimeToAcpEvents,
    event: PeaRuntimeEvent,
  ): void {
    for (const update of mapper.translate(event)) {
      this.runtimeSessions.enqueue(session.id, () => this.publishSessionUpdate(session.id, update));
    }

    if (event.type === "tool_started" && event.status === "pending_approval") {
      this.enqueuePermissionRequest(session, event);
    }
  }

  private attachSession(session: PeaRuntimeProtocolSession): AcpSession {
    const existing = this.mappers.get(session.id);
    if (existing) return Object.assign(session, { mapper: existing });

    const mapper = new PeaRuntimeToAcpEvents();
    this.mappers.set(session.id, mapper);
    session.unsubscribe = this.runtimeSessions.subscribe(session.id, (event) =>
      this.handleRuntimeEvent(session, mapper, event),
    );
    return Object.assign(session, { mapper });
  }

  private enqueuePermissionRequest(
    session: PeaRuntimeProtocolSession,
    event: Extract<PeaRuntimeEvent, { type: "tool_started" }>,
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

function permissionOutcomeText(
  outcome: Awaited<ReturnType<PeaAcpRuntimeClient["requestPermission"]>>,
): string {
  return outcome.outcome === "selected"
    ? `ACP permission selected: ${outcome.optionId}. The decision was recorded for Pea runtime continuation.`
    : "ACP permission cancelled. The decision was recorded for Pea runtime continuation.";
}
