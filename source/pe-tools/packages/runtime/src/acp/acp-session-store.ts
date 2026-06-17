import { createHash } from "node:crypto";
import type {
  ClientCapabilities,
  SessionId,
  SessionInfo,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
  peWorkbenchSessionMetadata,
  type PeWorkbenchSessionMetadata,
  type WorkbenchEvent,
  type WorkbenchJsonObject,
  type WorkbenchLoadThreadSnapshotRequest,
  type WorkbenchLoadThreadSnapshotResponse,
  type WorkbenchMessage,
  type WorkbenchProvenance,
  type WorkbenchRole,
} from "@pe/agent-contracts";
import { sanitizeJson, type RuntimeEvent } from "../events.ts";
import type {
  RuntimeAccessLevel,
  RuntimeFactory,
  RuntimeDescriptor,
  RuntimeLedgerEntry,
  RuntimeRecordProtocolEventRequest,
  RuntimeSessionControls,
  RuntimeThreadMessage,
} from "../runtime.ts";
import type { RuntimePrompt } from "../prompts.ts";
import {
  RuntimeProtocolSessions,
  type RuntimeProtocolSession,
  type RuntimeProtocolSessionInfo,
  type RuntimeQueueProtocolPromptResult,
  type RuntimeSessionHistoryEntry,
} from "../session/protocol-sessions.ts";
import type { RuntimeClientPermissionResponse } from "../client.ts";
import { acpSessionUpdateToWorkbenchEvents } from "@pe/agent-projection";
import { RuntimeAcpClient, type RuntimeAcpClientTransport } from "./runtime-client.ts";
import { RuntimeToAcpEvents } from "./events-map-runtime-acp.ts";

export interface RuntimeAcpSessionStoreRuntimeOptions {
  factory: RuntimeFactory;
  descriptor?: RuntimeDescriptor;
}

export interface RuntimeAcpSessionStoreSessionOptions {
  manager?: RuntimeProtocolSessions;
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
    const mapper = this.mappers.get(session.id) ?? this.mappers.get(id);
    if (!mapper) throw new Error(`Unknown ACP session: ${id}`);
    return Object.assign(session, { mapper });
  }

  async prompt(sessionId: SessionId, prompt: RuntimePrompt): Promise<"end_turn" | "cancelled"> {
    return this.runtimeSessions.sendPrompt(sessionId, prompt);
  }

  async queueMessage(
    sessionId: SessionId,
    prompt: RuntimePrompt,
  ): Promise<RuntimeQueueProtocolPromptResult> {
    return this.runtimeSessions.queuePrompt(sessionId, prompt);
  }

  cancel(sessionId: SessionId): void {
    this.runtimeSessions.cancel(sessionId);
  }

  readControls(sessionId: SessionId): RuntimeSessionControls {
    return this.runtimeSessions.readControls(sessionId);
  }

  async setModel(sessionId: SessionId, modelId: string): Promise<RuntimeSessionControls> {
    return this.runtimeSessions.setModel(sessionId, modelId);
  }

  async setAccessLevel(
    sessionId: SessionId,
    accessLevel: RuntimeAccessLevel,
  ): Promise<RuntimeSessionControls> {
    return this.runtimeSessions.setAccessLevel(sessionId, accessLevel);
  }

  async readWorkbenchLoadThreadSnapshot(
    request: WorkbenchLoadThreadSnapshotRequest,
  ): Promise<WorkbenchLoadThreadSnapshotResponse> {
    const session = await this.resume(request);
    const ledger = await this.readWorkbenchLedger(session);
    return {
      session: workbenchSessionInfo(session),
      messages: workbenchMessagesFromLedger(session, ledger),
      events: workbenchEventsFromLedger(session, ledger),
    };
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

  async list(cwd?: string | null): Promise<SessionInfo[]> {
    return (await this.runtimeSessions.listSessions({ protocol: "acp", cwd })).map(
      (session): SessionInfo => ({
        sessionId: session.id,
        cwd: session.cwd,
        additionalDirectories: session.additionalDirectories,
        title: session.title,
        updatedAt: session.updatedAt,
        _meta: peWorkbenchSessionMetadata({
          status: session.threadId ? "materialized" : "draft",
          threadId: session.threadId,
          resourceId: session.resourceId,
          lock: session.lock,
        }),
      }),
    );
  }

  async delete(sessionId: SessionId): Promise<void> {
    const resolved = await this.resolveSessionInfo(sessionId);
    try {
      await this.runtimeSessions.delete(resolved?.id ?? sessionId, { protocol: "acp" });
      this.clearSessionState(sessionId, resolved);
    } catch (error) {
      if (!this.hasRuntimeSession(sessionId, resolved)) this.clearSessionState(sessionId, resolved);
      throw error;
    }
  }

  async close(sessionId: SessionId): Promise<void> {
    const resolved = await this.resolveSessionInfo(sessionId);
    try {
      await this.runtimeSessions.close(resolved?.id ?? sessionId, { protocol: "acp" });
      this.clearSessionState(sessionId, resolved);
    } catch (error) {
      if (!this.hasRuntimeSession(sessionId, resolved)) this.clearSessionState(sessionId, resolved);
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    try {
      await this.runtimeSessions.closeAll();
      this.mappers.clear();
      this.requestedPermissionToolIds.clear();
    } catch (error) {
      this.clearClosedSessionState();
      throw error;
    }
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

  private async resolveSessionInfo(
    sessionId: SessionId,
  ): Promise<RuntimeProtocolSessionInfo | undefined> {
    const resolver = (
      this.runtimeSessions as RuntimeProtocolSessions & {
        resolveSessionInfo?: RuntimeProtocolSessions["resolveSessionInfo"];
      }
    ).resolveSessionInfo?.bind(this.runtimeSessions);
    return resolver?.({ id: sessionId, protocol: "acp" });
  }

  private clearSessionState(
    sessionId: SessionId,
    resolved: RuntimeProtocolSessionInfo | undefined,
  ): void {
    const ids = new Set(
      [sessionId, resolved?.id, resolved?.threadId, resolved?.externalThreadId].filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    );
    for (const id of ids) {
      this.mappers.delete(id);
      for (const key of Array.from(this.requestedPermissionToolIds)) {
        if (key.startsWith(`${id}:`)) this.requestedPermissionToolIds.delete(key);
      }
    }
  }

  private hasRuntimeSession(
    sessionId: SessionId,
    resolved: RuntimeProtocolSessionInfo | undefined,
  ): boolean {
    const ids = [resolved?.id, sessionId, resolved?.threadId, resolved?.externalThreadId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    for (const id of ids) {
      try {
        this.runtimeSessions.getSession(id);
        return true;
      } catch {
        // Try the next known alias.
      }
    }
    return false;
  }

  private clearClosedSessionState(): void {
    for (const sessionId of Array.from(this.mappers.keys())) {
      if (!this.hasRuntimeSession(sessionId, undefined)) {
        this.clearSessionState(sessionId, undefined);
      }
    }
  }

  private enqueuePermissionRequest(
    session: RuntimeProtocolSession,
    event: Extract<RuntimeEvent, { type: "tool_started" }>,
  ): void {
    const key = `${session.id}:${event.toolCallId}`;
    if (this.requestedPermissionToolIds.has(key)) return;
    this.requestedPermissionToolIds.add(key);

    this.runtimeSessions.enqueue(session.id, async () => {
      let outcome: RuntimeClientPermissionResponse;
      try {
        outcome = await this.client.requestPermission({
          sessionId: session.id,
          toolCall: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            title: event.title,
            input: event.input,
            tool: event.tool,
          },
        });
      } catch {
        outcome = { outcome: "cancelled" };
      }
      this.runtimeSessions.recordResumeDecision(session.id, {
        interruptId: `tool-approval:${event.toolCallId}`,
        status: outcome.outcome === "selected" ? "resolved" : "cancelled",
        payload: outcome.outcome === "selected" ? { optionId: outcome.optionId } : undefined,
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
    });
  }

  private async replayHistory(sessionId: SessionId): Promise<void> {
    const session = this.runtimeSessions.getSession(sessionId);
    const ledger = await this.readRuntimeSessionLedger(session);
    if (ledger.length > 0) {
      const coveredUserPromptSequences = userPromptSequencesCoveredByThreadMessages(ledger);
      const coveredTranscriptMessageIds = directWorkbenchMessageIds(
        session,
        ledger,
        coveredUserPromptSequences,
      );
      for (const entry of ledger) {
        await this.publishLedgerEntry(sessionId, entry, {
          coveredTranscriptMessageIds,
          coveredUserPromptSequences,
        });
      }
      return;
    }

    const history = this.runtimeSessions.history(sessionId);
    for (const [index, entry] of history.entries()) {
      if (entry.type === "prompt") {
        await this.publishSessionUpdate(
          sessionId,
          {
            sessionUpdate: "user_message_chunk",
            messageId: historyPromptMessageId(sessionId, index),
            content: { type: "text", text: entry.content },
          },
          { record: false },
        );
        continue;
      }
      if (entry.type === "protocol_event" && entry.protocol === "acp") {
        await this.publishSessionUpdate(
          sessionId,
          replayHistorySessionUpdate(sessionId, entry, index),
          {
            record: false,
          },
        );
      }
    }
  }

  private async publishPersistedMessage(
    sessionId: SessionId,
    message: Extract<RuntimeLedgerEntry, { type: "thread_message" }>["message"],
  ): Promise<void> {
    if (message.role === "user") {
      await this.publishSessionUpdate(
        sessionId,
        {
          sessionUpdate: "user_message_chunk",
          messageId: message.id,
          content: { type: "text", text: message.text },
        },
        { record: false },
      );
      return;
    }
    if (message.role === "assistant") {
      await this.publishSessionUpdate(
        sessionId,
        {
          sessionUpdate: "agent_message_chunk",
          messageId: message.id,
          content: { type: "text", text: message.text },
        },
        { record: false },
      );
    }
  }

  private async publishPersistedUserPrompt(
    sessionId: SessionId,
    entry: Extract<RuntimeLedgerEntry, { type: "user_prompt" }>,
  ): Promise<void> {
    await this.publishSessionUpdate(
      sessionId,
      {
        sessionUpdate: "user_message_chunk",
        messageId: userPromptMessageId(sessionId, entry),
        content: { type: "text", text: entry.content },
      },
      { record: false },
    );
  }

  private async publishLedgerEntry(
    sessionId: SessionId,
    entry: RuntimeLedgerEntry,
    options: {
      coveredTranscriptMessageIds?: Set<string>;
      coveredUserPromptSequences?: Set<number>;
    } = {},
  ): Promise<void> {
    if (entry.type === "thread_message") {
      await this.publishPersistedMessage(sessionId, entry.message);
      return;
    }
    if (entry.type === "user_prompt") {
      if (!options.coveredUserPromptSequences?.has(entry.sequence)) {
        await this.publishPersistedUserPrompt(sessionId, entry);
      }
      return;
    }
    if (entry.type === "protocol_event" && entry.protocol === "acp") {
      const update = replaySessionUpdate(sessionId, entry);
      const messageId = readStringProperty(update, "messageId");
      if (
        isTranscriptSessionUpdate(update) &&
        messageId &&
        options.coveredTranscriptMessageIds?.has(messageId)
      ) {
        return;
      }
      await this.publishSessionUpdate(sessionId, update, {
        record: false,
      });
    }
  }

  private async publishSessionUpdate(
    sessionId: SessionId,
    update: SessionUpdate,
    options: { record?: boolean } = {},
  ): Promise<void> {
    if (options.record !== false)
      this.runtimeSessions.recordProtocolEvent(sessionId, "acp", update, {
        projection: acpProjectionForSessionUpdate(sessionId, update),
      });
    await this.updateSink.sessionUpdate({ sessionId, update });
  }

  private async readWorkbenchLedger(
    session: RuntimeProtocolSession,
  ): Promise<RuntimeLedgerEntry[]> {
    return this.readRuntimeSessionLedger(session, { requireThreadLedger: true });
  }

  private async readRuntimeSessionLedger(
    session: RuntimeProtocolSession,
    options: { requireThreadLedger?: boolean } = {},
  ): Promise<RuntimeLedgerEntry[]> {
    const readKernelLedger = session.runtime.kernel?.readSessionLedger?.bind(
      session.runtime.kernel,
    );
    if (readKernelLedger) return readKernelLedger(session.id);

    if (!session.threadId) return [];
    if (!session.runtime.sessions.readThreadLedger) {
      if (!options.requireThreadLedger) return [];
      throw new Error("Runtime thread ledger is not available for ACP workbench snapshots.");
    }

    const ledger = await session.runtime.sessions.readThreadLedger({
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
    return ledger;
  }
}

function workbenchMessagesFromLedger(
  session: RuntimeProtocolSession,
  ledger: RuntimeLedgerEntry[],
): WorkbenchMessage[] {
  const coveredUserPromptSequences = userPromptSequencesCoveredByThreadMessages(ledger);
  const directMessageIds = directWorkbenchMessageIds(session, ledger, coveredUserPromptSequences);
  const protocolMessages = new Map<string, WorkbenchMessage>();
  const messages: WorkbenchMessage[] = [];

  for (const entry of ledger) {
    if (entry.type === "thread_message") {
      messages.push(workbenchMessageFromThreadMessage(session, entry.message));
      continue;
    }
    if (entry.type === "user_prompt" && !coveredUserPromptSequences.has(entry.sequence)) {
      messages.push(workbenchMessageFromUserPrompt(session, entry));
      continue;
    }
    if (entry.type === "protocol_event" && entry.protocol === "acp") {
      const message = workbenchMessageFromTranscriptProtocolEvent(session, entry, directMessageIds);
      if (message) appendProtocolTranscriptMessage(messages, protocolMessages, message);
    }
  }

  return messages;
}

function directWorkbenchMessageIds(
  session: RuntimeProtocolSession,
  ledger: RuntimeLedgerEntry[],
  coveredUserPromptSequences: Set<number>,
): Set<string> {
  const ids = new Set<string>();
  for (const entry of ledger) {
    if (entry.type === "thread_message") ids.add(entry.message.id);
    if (entry.type === "user_prompt" && !coveredUserPromptSequences.has(entry.sequence)) {
      ids.add(userPromptMessageId(session.id, entry));
    }
  }
  return ids;
}

function appendProtocolTranscriptMessage(
  messages: WorkbenchMessage[],
  protocolMessages: Map<string, WorkbenchMessage>,
  message: WorkbenchMessage,
): void {
  const existing = protocolMessages.get(message.id);
  if (!existing) {
    protocolMessages.set(message.id, message);
    messages.push(message);
    return;
  }

  const existingPart = existing.parts[0];
  const messagePart = message.parts[0];
  if (existingPart?.kind === "text" && messagePart?.kind === "text") {
    existing.parts = [{ ...existingPart, text: `${existingPart.text}${messagePart.text}` }];
    existing.updatedAt = message.updatedAt ?? existing.updatedAt;
  }
}

function workbenchEventsFromLedger(
  session: RuntimeProtocolSession,
  ledger: RuntimeLedgerEntry[],
): WorkbenchEvent[] {
  return ledger.flatMap((entry) => {
    if (entry.type === "session_identity") {
      return [sessionIdentityToWorkbenchEvent(session, entry)];
    }
    if (entry.type === "raw_mastra_event") {
      return [rawMastraEventToWorkbenchEvent(session, entry)];
    }
    if (entry.type === "runtime_event") {
      return [runtimeEventToWorkbenchEvent(session, entry)];
    }
    if (entry.type === "queue_event") return [queueEventToWorkbenchEvent(session, entry)];
    if (entry.type === "protocol_event" && entry.protocol === "acp") {
      if (!isAcpSessionUpdate(entry.payload) || isTranscriptSessionUpdate(entry.payload)) return [];
      return acpSessionUpdateToWorkbenchEvents(session.id, entry.payload);
    }
    return [];
  });
}

function sessionIdentityToWorkbenchEvent(
  session: RuntimeProtocolSession,
  entry: Extract<RuntimeLedgerEntry, { type: "session_identity" }>,
): WorkbenchEvent {
  return {
    type: "debug_event_recorded",
    debugEvent: {
      id: `runtime:${session.id}:session_identity:${entry.sequence}`,
      source: "runtime",
      type: "session_identity",
      label: "session identity",
      timestamp: entry.createdAt,
      payload: sessionIdentityPayload(entry),
    },
  };
}

function sessionIdentityPayload(
  entry: Extract<RuntimeLedgerEntry, { type: "session_identity" }>,
): WorkbenchJsonObject {
  return {
    sessionId: entry.sessionId,
    status: entry.status,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.protocol ? { protocol: entry.protocol } : {}),
    ...(entry.externalThreadId ? { externalThreadId: entry.externalThreadId } : {}),
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
  };
}

function rawMastraEventToWorkbenchEvent(
  session: RuntimeProtocolSession,
  entry: Extract<RuntimeLedgerEntry, { type: "raw_mastra_event" }>,
): WorkbenchEvent {
  return {
    type: "debug_event_recorded",
    debugEvent: {
      id: `runtime:${session.id}:raw_mastra_event:${entry.sequence}`,
      source: "runtime",
      type: "raw_mastra_event",
      label: entry.rawEventType
        ? `raw Mastra ${entry.rawEventType.replaceAll("_", " ")}`
        : "raw Mastra event",
      timestamp: entry.createdAt,
      payload: rawMastraEventPayload(entry),
    },
  };
}

function rawMastraEventPayload(
  entry: Extract<RuntimeLedgerEntry, { type: "raw_mastra_event" }>,
): WorkbenchJsonObject {
  return {
    ...(entry.rawEventType ? { rawEventType: entry.rawEventType } : {}),
    rawEvent: sanitizeJson(entry.rawEvent) as WorkbenchJsonObject[string],
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
  };
}

function runtimeEventToWorkbenchEvent(
  session: RuntimeProtocolSession,
  entry: Extract<RuntimeLedgerEntry, { type: "runtime_event" }>,
): WorkbenchEvent {
  return {
    type: "debug_event_recorded",
    debugEvent: {
      id: `runtime:${session.id}:runtime_event:${entry.sequence}`,
      source: "runtime",
      type: "runtime_event",
      label: `runtime ${entry.event.type.replaceAll("_", " ")}`,
      timestamp: entry.createdAt,
      payload: runtimeEventPayload(entry),
    },
  };
}

function runtimeEventPayload(
  entry: Extract<RuntimeLedgerEntry, { type: "runtime_event" }>,
): WorkbenchJsonObject {
  return {
    event: sanitizeJson(entry.event) as WorkbenchJsonObject[string],
    provenance: sanitizeJson(entry.provenance) as WorkbenchJsonObject[string],
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
  };
}

function queueEventToWorkbenchEvent(
  session: RuntimeProtocolSession,
  entry: Extract<RuntimeLedgerEntry, { type: "queue_event" }>,
): WorkbenchEvent {
  return {
    type: "debug_event_recorded",
    debugEvent: {
      id: `runtime:${session.id}:queue_event:${entry.sequence}`,
      source: "runtime",
      type: "queue_event",
      label: entry.decision.replaceAll("_", " "),
      timestamp: entry.createdAt,
      payload: queueEventPayload(entry),
    },
  };
}

function queueEventPayload(
  entry: Extract<RuntimeLedgerEntry, { type: "queue_event" }>,
): WorkbenchJsonObject {
  return {
    decision: entry.decision,
    contentPreview: previewText(entry.content),
    contentLength: entry.content.length,
    ...(entry.protocol ? { protocol: entry.protocol } : {}),
    ...(entry.protocolSessionId ? { protocolSessionId: entry.protocolSessionId } : {}),
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
  };
}

function previewText(value: string, maxLength = 160): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function workbenchSessionInfo(
  session: RuntimeProtocolSession,
): WorkbenchLoadThreadSnapshotResponse["session"] {
  const metadata: PeWorkbenchSessionMetadata = {
    status: session.threadId ? "materialized" : "draft",
    ...(session.threadId ? { threadId: session.threadId } : {}),
    ...(session.resourceId ? { resourceId: session.resourceId } : {}),
    ...(session.lock ? { lock: session.lock } : {}),
  };
  return {
    sessionId: session.id,
    cwd: session.cwd,
    additionalDirectories: session.additionalDirectories,
    title: session.title,
    updatedAt: session.updatedAt,
    metadata: peWorkbenchSessionMetadata(metadata),
  };
}

function workbenchMessageFromThreadMessage(
  session: RuntimeProtocolSession,
  message: RuntimeThreadMessage,
): WorkbenchMessage {
  const provenance: WorkbenchProvenance = {
    source: "runtime",
    protocol: session.protocol === "acp" ? ("acp" as const) : ("local" as const),
    sessionId: session.id,
    ...(session.threadId ? { threadId: session.threadId } : {}),
    messageId: message.id,
  };
  const metadata: WorkbenchJsonObject | undefined =
    message.role === "signal" || message.type
      ? {
          runtimeRole: message.role,
          ...(message.type ? { runtimeType: message.type } : {}),
        }
      : undefined;

  return {
    id: message.id,
    role: workbenchRole(message.role),
    parts: [
      {
        kind: "text" as const,
        text: message.text,
        provenance,
      },
    ],
    status: "complete" as const,
    ...(message.createdAt ? { createdAt: message.createdAt, updatedAt: message.createdAt } : {}),
    provenance,
    ...(metadata ? { metadata } : {}),
  };
}

function workbenchMessageFromUserPrompt(
  session: RuntimeProtocolSession,
  entry: Extract<RuntimeLedgerEntry, { type: "user_prompt" }>,
): WorkbenchMessage {
  const id = userPromptMessageId(session.id, entry);
  const provenance: WorkbenchProvenance = {
    source: "runtime",
    protocol: session.protocol === "acp" ? ("acp" as const) : ("local" as const),
    sessionId: session.id,
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    messageId: id,
  };
  return {
    id,
    role: "user",
    parts: [
      {
        kind: "text" as const,
        text: entry.content,
        provenance,
      },
    ],
    status: "complete" as const,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    provenance,
    metadata: { runtimeType: "user_prompt" },
  };
}

function workbenchMessageFromTranscriptProtocolEvent(
  session: RuntimeProtocolSession,
  entry: Extract<RuntimeLedgerEntry, { type: "protocol_event" }>,
  directMessageIds: Set<string>,
): WorkbenchMessage | undefined {
  if (!isAcpSessionUpdate(entry.payload)) return undefined;
  const update = replaySessionUpdate(session.id, entry);
  if (!isTranscriptSessionUpdate(update)) return undefined;
  const id = readStringProperty(update, "messageId");
  if (!id || directMessageIds.has(id)) return undefined;
  const text = transcriptUpdateText(update);
  if (text === undefined) return undefined;
  const provenance: WorkbenchProvenance = {
    source: "runtime",
    protocol: "acp",
    sessionId: session.id,
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    messageId: id,
    updateType: update.sessionUpdate,
  };
  return {
    id,
    role: transcriptUpdateRole(update),
    parts: [
      {
        kind: "text" as const,
        text,
        provenance,
      },
    ],
    status: "complete" as const,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    provenance,
    metadata: { runtimeType: "protocol_event" },
  };
}

function transcriptUpdateRole(
  update: Extract<
    SessionUpdate,
    {
      sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk";
    }
  >,
): WorkbenchRole {
  if (update.sessionUpdate === "user_message_chunk") return "user";
  if (update.sessionUpdate === "agent_thought_chunk") return "thought";
  return "assistant";
}

function transcriptUpdateText(update: SessionUpdate): string | undefined {
  const record = isRecord(update) ? (update as Record<string, unknown>) : {};
  const content = record.content;
  if (typeof content === "string") return content;
  if (!isRecord(content)) return undefined;
  return typeof content.text === "string" ? content.text : undefined;
}

function workbenchRole(role: RuntimeThreadMessage["role"]): WorkbenchRole {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return "system";
}

function userPromptMessageId(
  sessionId: string,
  entry: Extract<RuntimeLedgerEntry, { type: "user_prompt" }>,
): string {
  return `runtime:${sessionId}:user_prompt:${entry.sequence}`;
}

function historyPromptMessageId(sessionId: string, index: number): string {
  return `runtime:${sessionId}:history_prompt:${index}`;
}

function replaySessionUpdate(
  sessionId: string,
  entry: Extract<RuntimeLedgerEntry, { type: "protocol_event" }>,
): SessionUpdate {
  const update = entry.payload as SessionUpdate;
  if (!isTranscriptSessionUpdate(update) || readStringProperty(update, "messageId")) return update;
  return {
    ...update,
    messageId: entry.projection?.id ?? `runtime:${sessionId}:protocol_event:${entry.sequence}`,
  };
}

function replayHistorySessionUpdate(
  sessionId: string,
  entry: Extract<RuntimeSessionHistoryEntry, { type: "protocol_event" }>,
  index: number,
): SessionUpdate {
  const update = entry.payload as SessionUpdate;
  if (!isTranscriptSessionUpdate(update) || readStringProperty(update, "messageId")) return update;
  return {
    ...update,
    messageId: entry.projection?.id ?? `runtime:${sessionId}:history_protocol_event:${index}`,
  };
}

function userPromptSequencesCoveredByThreadMessages(ledger: RuntimeLedgerEntry[]): Set<number> {
  const prompts = ledger.filter(
    (entry): entry is Extract<RuntimeLedgerEntry, { type: "user_prompt" }> =>
      entry.type === "user_prompt",
  );
  const covered = new Set<number>();
  for (const entry of ledger) {
    if (entry.type !== "thread_message" || entry.message.role !== "user") continue;
    const prompt = prompts.find(
      (candidate) =>
        !covered.has(candidate.sequence) &&
        candidate.content === entry.message.text &&
        candidate.threadId === entry.threadId &&
        candidate.resourceId === entry.resourceId,
    );
    if (prompt) covered.add(prompt.sequence);
  }
  return covered;
}

function runtimeFactory(options: RuntimeAcpSessionStoreOptions): RuntimeFactory {
  const factory = options.runtime?.factory;
  if (!factory) throw new Error("Runtime ACP session store requires runtime.factory.");
  return factory;
}

function runtimeDescriptor(options: RuntimeAcpSessionStoreOptions): RuntimeDescriptor {
  return options.runtime?.descriptor ?? runtimeFactory(options).descriptor;
}

function permissionOutcomeText(
  outcome: Awaited<ReturnType<RuntimeAcpClient["requestPermission"]>>,
): string {
  return outcome.outcome === "selected"
    ? `ACP permission selected: ${outcome.optionId}. The decision was recorded for runtime continuation.`
    : "ACP permission cancelled. The decision was recorded for runtime continuation.";
}

function isAcpSessionUpdate(value: unknown): value is SessionUpdate {
  return isRecord(value) && typeof value.sessionUpdate === "string";
}

function isTranscriptSessionUpdate(update: SessionUpdate): update is Extract<
  SessionUpdate,
  {
    sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk";
  }
> {
  return (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  );
}

function acpProjectionForSessionUpdate(
  sessionId: SessionId,
  update: SessionUpdate,
): NonNullable<RuntimeRecordProtocolEventRequest["projection"]> {
  const sourceSequence = readNumericProperty(update, "sequence");
  return {
    id: `acp:${sessionId}:${update.sessionUpdate}:${acpProjectionSuffix(update)}`,
    ...(sourceSequence === undefined ? {} : { sourceSequence }),
  };
}

function acpProjectionSuffix(update: SessionUpdate): string {
  const messageId = readStringProperty(update, "messageId");
  if (messageId) return `message:${sanitizeProjectionId(messageId)}`;

  const toolCallId = readStringProperty(update, "toolCallId");
  if (toolCallId) return `tool:${sanitizeProjectionId(toolCallId)}`;

  const title = readStringProperty(update, "title");
  if (title) return `title:${sanitizeProjectionId(title)}`;

  const hash = createHash("sha256").update(stableJson(update)).digest("hex").slice(0, 12);
  return `payload:${hash}`;
}

function sanitizeProjectionId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 80) || "value";
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const record = isRecord(value) ? value : {};
  const property = record[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}

function readNumericProperty(value: unknown, key: string): number | undefined {
  const record = isRecord(value) ? value : {};
  const property = record[key];
  return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { RuntimeAcpSessionStore as PeaAcpSessionStore };
