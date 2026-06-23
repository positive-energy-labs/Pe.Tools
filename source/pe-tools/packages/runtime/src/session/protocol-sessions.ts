import path from "node:path";
import type { RuntimeContextEntry } from "../context.ts";
import {
  sanitizeJson,
  type RuntimeEvent,
  type RuntimeJsonValue,
  type RuntimeProtocol,
} from "../events.ts";
import { createRuntimeResumeContextEntries, type RuntimeResumeDecision } from "../interrupts.ts";
import {
  createRuntimeResourceContextEntries,
  createRuntimeResourceScope,
  type RuntimeResource,
} from "../resources.ts";
import type {
  RuntimeAccessLevel,
  RuntimeFactory,
  RuntimeHandle,
  RuntimeHandleHarness,
  RuntimeHandleServices,
  RuntimeLedgerEntry,
  RuntimeQueueSessionMessageResult,
  RuntimeRecordProtocolEventRequest,
  RuntimeSendMessageOptions,
  RuntimeSessionControls,
  RuntimeThreadLockInfo,
  RuntimeThreadInfo,
  RuntimeThreadMessage,
} from "../runtime.ts";
import type { RuntimeThreadIndex } from "../storage/thread-index.ts";

export type RuntimeSessionHistoryEntry =
  | {
      type: "prompt";
      content: string;
      createdAt: string;
    }
  | {
      type: "protocol_event";
      protocol: RuntimeProtocol;
      payload: RuntimeJsonValue;
      projection?: RuntimeRecordProtocolEventRequest["projection"];
      createdAt: string;
    };

export interface RuntimeProtocolSession<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  id: string;
  protocol: RuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  runtime: RuntimeHandle<TState, TServices, THarness>;
  threadId?: string;
  resourceId?: string;
  lock?: RuntimeThreadLockInfo;
  externalThreadId?: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
  promptActive: boolean;
  pendingResumeDecisions: RuntimeResumeDecision[];
  continuationGeneration: number;
  restoredFromRegistry: boolean;
  protocolMetadataPersisted: boolean;
  emitQueue: Promise<void>;
  unsubscribe: () => void;
}

export interface RuntimeProtocolSessionsOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  factory: RuntimeFactory<TState, TServices, THarness>;
  defaultCwd?: string;
  threadIndex?: RuntimeThreadIndex;
}

const protocolThreadMetadataKey = "peRuntimeProtocolSession";

interface RuntimeProtocolThreadMetadata {
  protocol: RuntimeProtocol;
  protocolSessionId?: string;
  externalThreadId?: string;
}

export interface RuntimeCreateProtocolSessionRequest {
  protocol: RuntimeProtocol;
  cwd?: string;
  additionalDirectories?: string[];
  title?: string;
  externalThreadId?: string;
}

export interface RuntimeSendProtocolPromptRequest {
  content: string;
  context?: RuntimeContextEntry[];
  resources?: RuntimeResource[];
  resumeDecisions?: RuntimeResumeDecision[];
}

export interface RuntimeQueueProtocolPromptResult {
  queued: boolean;
  stopReason?: "end_turn" | "cancelled";
}

export interface RuntimeProtocolSessionInfo {
  id: string;
  protocol: RuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  threadId?: string;
  resourceId?: string;
  lock?: RuntimeThreadLockInfo;
  externalThreadId?: string;
  createdAt: string;
  updatedAt: string;
  promptActive: boolean;
}

export class RuntimeProtocolSessions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = RuntimeHandleHarness<TState>,
> {
  private readonly factory: RuntimeFactory<TState, TServices, THarness>;
  private readonly sessions = new Map<
    string,
    RuntimeProtocolSession<TState, TServices, THarness>
  >();
  private readonly externalThreadIndex = new Map<string, string>();
  private readonly inMemoryHistory = new Map<string, RuntimeSessionHistoryEntry[]>();

  constructor(
    private readonly options: RuntimeProtocolSessionsOptions<TState, TServices, THarness>,
  ) {
    this.factory = options.factory;
  }

  async createSession(
    request: RuntimeCreateProtocolSessionRequest,
  ): Promise<RuntimeProtocolSession<TState, TServices, THarness>> {
    const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    const title = request.title ?? `${request.protocol} session`;
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories,
      protocol: request.protocol,
    });
    const now = new Date().toISOString();
    const draftSession = runtime.kernel.createDraftSession({
      title,
      protocol: request.protocol,
      externalThreadId: request.externalThreadId,
    });

    const session: RuntimeProtocolSession<TState, TServices, THarness> = {
      id: draftSession.sessionId,
      protocol: request.protocol,
      cwd: runtime.workspace?.cwd ?? cwd,
      additionalDirectories,
      title,
      runtime,
      threadId: undefined,
      resourceId: undefined,
      externalThreadId: request.externalThreadId,
      createdAt: now,
      updatedAt: now,
      cancelled: false,
      promptActive: false,
      pendingResumeDecisions: [],
      continuationGeneration: 0,
      restoredFromRegistry: false,
      protocolMetadataPersisted: false,
      emitQueue: Promise.resolve(),
      unsubscribe: () => undefined,
    };

    this.trackSession(session);
    return session;
  }

  async forkSession(
    sourceId: string,
    request: {
      cwd: string;
      additionalDirectories?: string[];
      title?: string;
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession<TState, TServices, THarness>> {
    const source = await this.sourceSession(sourceId, {
      cwd: request.cwd,
      protocol: request.protocol,
    });
    if (request.protocol && source.protocol !== request.protocol) {
      throw new Error(
        `Runtime session ${sourceId} belongs to protocol '${source.protocol}' and cannot fork as '${request.protocol}'.`,
      );
    }

    const session = await this.createSession({
      protocol: source.protocol,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      title: request.title ?? `${source.title} fork`,
    });
    await seedHarnessSandboxAllowedPaths(
      session.runtime,
      harnessSandboxAllowedPaths(source.runtime),
    );
    if (source.threadId) {
      await this.forkMaterializeSession(session, source);
    } else {
      const sourceHistory = await this.readHistory(source.id);
      if (sourceHistory.length > 0) this.inMemoryHistory.set(session.id, [...sourceHistory]);
    }
    return session;
  }

  async getOrCreateThreadSession(
    request: RuntimeCreateProtocolSessionRequest & {
      externalThreadId: string;
    },
  ): Promise<RuntimeProtocolSession<TState, TServices, THarness>> {
    const externalKey = externalThreadKey(request.protocol, request.externalThreadId);
    const existingId = this.externalThreadIndex.get(externalKey);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) {
        return this.resumeSession(existingId, {
          ...request,
          cwd: existing.cwd,
          additionalDirectories: request.additionalDirectories ?? existing.additionalDirectories,
        });
      }
      this.externalThreadIndex.delete(externalKey);
    }

    const persisted = await this.findSessionByExternalThreadId(request);
    if (persisted) {
      return this.resumeSession(persisted.id, {
        ...request,
        cwd: persisted.cwd,
        additionalDirectories: request.additionalDirectories ?? persisted.additionalDirectories,
        protocol: request.protocol,
      });
    }

    return this.createSession(request);
  }

  getSession(id: string): RuntimeProtocolSession<TState, TServices, THarness> {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, undefined);
    if (!session) throw new Error(`Unknown Runtime session: ${id}`);
    return session;
  }

  activeSessionInfo(
    id: string | undefined,
    protocol?: RuntimeProtocol,
  ): RuntimeProtocolSession<TState, TServices, THarness> | undefined {
    return id ? (this.sessions.get(id) ?? this.activeSessionForId(id, protocol)) : undefined;
  }

  async resumeSession(
    id: string,
    request: {
      cwd?: string;
      additionalDirectories?: string[];
      protocol?: RuntimeProtocol;
    } = {},
  ): Promise<RuntimeProtocolSession<TState, TServices, THarness>> {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, request.protocol);
    if (!session) return this.rehydrateSession(id, request);
    if (request.protocol && session.protocol !== request.protocol) {
      throw new Error(
        `Runtime session ${id} belongs to protocol '${session.protocol}' and cannot resume as '${request.protocol}'.`,
      );
    }

    const cwd = normalizeCwd(request.cwd ?? session.cwd);
    if (normalizeCwd(session.cwd) !== cwd) {
      throw new Error(
        `Runtime session ${id} was created for cwd '${session.cwd}' and cannot resume with cwd '${request.cwd}'.`,
      );
    }

    session.additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? session.additionalDirectories,
    );
    session.updatedAt = new Date().toISOString();
    return session;
  }

  async listSessions(
    filter: { cwd?: string | null; protocol?: RuntimeProtocol } = {},
  ): Promise<RuntimeProtocolSessionInfo[]> {
    const startedAt = performance.now();
    const cwd = normalizeCwd(filter.cwd ?? this.options.defaultCwd ?? process.cwd());
    const activeSessions = Array.from(this.sessions.values())
      .filter((session) => !filter.protocol || session.protocol === filter.protocol)
      .filter((session) => normalizeCwd(session.cwd) === cwd);
    const activeIds = new Set(activeSessions.map((session) => session.id));
    const activeThreadIds = new Set(activeSessions.flatMap((session) => session.threadId ?? []));
    const activeSession = activeSessions.at(0);
    if (!activeSession && this.options.threadIndex) {
      const threads = await this.options.threadIndex.listThreadSessions({
        cwd,
        protocol: filter.protocol ?? "acp",
      });
      const result = threads
        .map((thread) => threadInfo(thread, { cwd, protocol: filter.protocol ?? "acp" }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      logProtocolTiming("listSessions index", startedAt, {
        protocol: filter.protocol ?? "acp",
        activeSessions: activeSessions.length,
        sessions: result.length,
      });
      return result;
    }

    const runtime = activeSession
      ? this.getSession(activeSession.id).runtime
      : await this.createListRuntime(cwd, filter.protocol ?? "acp");

    try {
      const threads = await this.listThreadSessions(runtime, {
        cwd,
        protocol: filter.protocol ?? "acp",
      });
      const threadsById = new Map(threads.map((thread) => [thread.threadId, thread]));
      const active = activeSessions.map((session) =>
        sessionInfo(
          refreshSessionListedThreadState(session, threadsById.get(session.threadId ?? "")),
        ),
      );
      const listed = threads
        .map((thread) => threadInfo(thread, { cwd, protocol: filter.protocol ?? "acp" }))
        .filter(
          (thread) =>
            !activeIds.has(thread.id) &&
            (!thread.threadId || !activeThreadIds.has(thread.threadId)),
        );
      const result = [...active, ...listed].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
      logProtocolTiming("listSessions runtime", startedAt, {
        protocol: filter.protocol ?? "acp",
        activeSessions: activeSessions.length,
        sessions: result.length,
      });
      return result;
    } finally {
      if (!activeSession) await runtime.close?.();
    }
  }

  async resolveSessionInfo(request: {
    id: string;
    cwd?: string | null;
    protocol?: RuntimeProtocol;
  }): Promise<RuntimeProtocolSessionInfo | undefined> {
    const active = this.activeSessionForId(request.id, request.protocol);
    if (active && (!request.cwd || normalizeCwd(active.cwd) === normalizeCwd(request.cwd))) {
      return sessionInfo(active);
    }
    return (await this.listSessions({ cwd: request.cwd, protocol: request.protocol })).find(
      (session) => sessionMatchesId(session, request.id),
    );
  }

  subscribe(id: string, listener: (event: RuntimeEvent) => void | Promise<void>): () => void {
    const session = this.getSession(id);
    return session.runtime.kernel.subscribe(listener);
  }

  enqueue(id: string, action: () => Promise<void> | void): void {
    const session = this.getSession(id);
    const continuationGeneration = session.continuationGeneration;
    session.emitQueue = session.emitQueue
      .then(async () => {
        if (this.sessions.get(session.id) !== session) return;
        if (session.continuationGeneration !== continuationGeneration) return;
        await action();
      })
      .catch(() => undefined);
  }

  recordProtocolEvent(
    id: string,
    protocol: RuntimeProtocol,
    payload: unknown,
    options: Pick<RuntimeRecordProtocolEventRequest, "projection"> = {},
  ): void {
    const session = this.getSession(id);
    if (session.threadId) {
      session.runtime.kernel.recordSessionProtocolEvent(session.id, {
        protocol,
        payload,
        projection: options.projection,
      });
      return;
    }

    // Draft sessions have no thread yet; buffer protocol events in memory until materialized.
    this.appendHistory(session.id, {
      type: "protocol_event",
      protocol,
      payload: sanitizeHistoryPayload(payload),
      projection: options.projection,
      createdAt: new Date().toISOString(),
    });
  }

  history(id: string): RuntimeSessionHistoryEntry[] {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, undefined);
    const historyId = session?.id ?? id;
    return [...(this.inMemoryHistory.get(historyId) ?? []), ...this.kernelHistory(historyId)];
  }

  async readHistory(id: string): Promise<RuntimeSessionHistoryEntry[]> {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, undefined);
    if (!session?.threadId) return this.history(id);

    const ledger = await readRuntimeSessionLedger(session);
    return [
      ...(this.inMemoryHistory.get(session.id) ?? []),
      ...ledger.flatMap(historyEntryFromLedger),
    ];
  }

  async readListedHistory(info: RuntimeProtocolSessionInfo): Promise<RuntimeSessionHistoryEntry[]> {
    const startedAt = performance.now();
    const session = this.sessions.get(info.id) ?? this.activeSessionForId(info.id, info.protocol);
    if (session) {
      const history = await this.readHistory(session.id);
      logProtocolTiming("readListedHistory active", startedAt, {
        id: info.id,
        entries: history.length,
      });
      return history;
    }
    if (!info.threadId) {
      const history = this.history(info.id);
      logProtocolTiming("readListedHistory draft", startedAt, {
        id: info.id,
        entries: history.length,
      });
      return history;
    }

    const runtime = await this.createListRuntime(info.cwd, info.protocol);
    try {
      const ledger = await runtime.kernel.readThreadLedger({
        threadId: info.threadId,
        resourceId: info.resourceId,
      });
      const history = ledger.flatMap(historyEntryFromLedger);
      logProtocolTiming("readListedHistory persisted", startedAt, {
        id: info.id,
        threadId: info.threadId,
        entries: history.length,
      });
      return history;
    } finally {
      await runtime.close?.();
    }
  }

  async readListedLedger(info: RuntimeProtocolSessionInfo): Promise<RuntimeLedgerEntry[]> {
    const session = this.sessions.get(info.id) ?? this.activeSessionForId(info.id, info.protocol);
    if (session?.threadId) return readRuntimeSessionLedger(session);
    if (!info.threadId) return [];

    const runtime = await this.createListRuntime(info.cwd, info.protocol);
    try {
      return await runtime.kernel.readThreadLedger({
        threadId: info.threadId,
        resourceId: info.resourceId,
      });
    } finally {
      await runtime.close?.();
    }
  }

  async readListedMessages(info: RuntimeProtocolSessionInfo): Promise<RuntimeThreadMessage[]> {
    const startedAt = performance.now();
    const session = this.sessions.get(info.id) ?? this.activeSessionForId(info.id, info.protocol);
    if (session) {
      const messages = await readRuntimeSessionMessages(session);
      logProtocolTiming("readListedMessages active", startedAt, {
        id: info.id,
        threadId: info.threadId,
        messages: messages.length,
      });
      return messages;
    }
    if (!info.threadId) {
      logProtocolTiming("readListedMessages draft", startedAt, { id: info.id, messages: 0 });
      return [];
    }

    if (this.options.threadIndex?.readThreadMessages) {
      const messages = await this.options.threadIndex.readThreadMessages({
        threadId: info.threadId,
        resourceId: info.resourceId,
      });
      logProtocolTiming("readListedMessages index", startedAt, {
        id: info.id,
        threadId: info.threadId,
        messages: messages.length,
      });
      return messages;
    }

    const runtime = await this.createListRuntime(info.cwd, info.protocol);
    try {
      const messages = await runtime.kernel.readThreadMessages({
        threadId: info.threadId,
        resourceId: info.resourceId,
      });
      logProtocolTiming("readListedMessages persisted", startedAt, {
        id: info.id,
        threadId: info.threadId,
        messages: messages.length,
      });
      return messages;
    } finally {
      await runtime.close?.();
    }
  }

  recordResumeDecision(id: string, decision: RuntimeResumeDecision): void {
    const session = this.getSession(id);
    if (session.cancelled) return;
    session.pendingResumeDecisions = [...session.pendingResumeDecisions, decision];
    session.updatedAt = new Date().toISOString();
  }

  async sendPrompt(
    id: string,
    request: RuntimeSendProtocolPromptRequest,
  ): Promise<"end_turn" | "cancelled"> {
    const session = this.getSession(id);
    if (session.promptActive)
      throw new Error(`Runtime session ${id} already has an active prompt.`);

    const result = await this.queuePrompt(id, request, { requireIdle: true });
    return result.stopReason ?? (session.cancelled ? "cancelled" : "end_turn");
  }

  async queuePrompt(
    id: string,
    request: RuntimeSendProtocolPromptRequest,
    options: { requireIdle?: boolean } = {},
  ): Promise<RuntimeQueueProtocolPromptResult> {
    const session = this.getSession(id);
    if (options.requireIdle && session.promptActive)
      throw new Error(`Runtime session ${id} already has an active prompt.`);

    const wasActive = session.promptActive;
    if (!wasActive) {
      session.cancelled = false;
      session.promptActive = true;
    }
    session.updatedAt = new Date().toISOString();
    const consumedResumeDecisions = session.pendingResumeDecisions;
    const resumeDecisions = mergeResumeDecisions(consumedResumeDecisions, request.resumeDecisions);
    session.pendingResumeDecisions = [];
    try {
      await this.materializeSession(session);
      const message = {
        content: request.content,
        context: createPromptContext(session, { ...request, resumeDecisions }),
        ...(resumeDecisions ? { resumeDecisions } : {}),
        protocol: session.protocol,
        protocolSessionId: session.id,
        resourceId: session.resourceId,
        threadId: session.threadId,
      };
      const result = options.requireIdle
        ? await sendPromptWithoutQueue(session, message)
        : await session.runtime.kernel.queueSessionMessage(session.id, message);
      const resultSession = runtimeQueueMessageResultSession(result);
      if (resultSession) {
        session.threadId = resultSession.threadId ?? session.threadId;
        session.resourceId = resultSession.resourceId ?? session.resourceId;
        session.updatedAt = resultSession.updatedAt;
      }
      // The kernel records every prompt in its ledger, so no in-memory fallback is needed.
      if (!result.queued) await session.emitQueue;
      return {
        queued: result.queued,
        ...(result.queued
          ? {}
          : { stopReason: session.cancelled ? ("cancelled" as const) : ("end_turn" as const) }),
      };
    } catch (error) {
      if (!session.cancelled) {
        session.pendingResumeDecisions = [
          ...consumedResumeDecisions,
          ...session.pendingResumeDecisions,
        ];
      }
      throw error;
    } finally {
      if (!wasActive) session.promptActive = false;
      session.updatedAt = new Date().toISOString();
    }
  }

  cancel(id: string): void {
    const session = this.getSession(id);
    cancelKernelSession(session);
    invalidateSessionContinuation(session);
    session.updatedAt = new Date().toISOString();
  }

  readControls(id: string): RuntimeSessionControls {
    return this.getSession(id).runtime.kernel.readControls();
  }

  async setModel(id: string, modelId: string): Promise<RuntimeSessionControls> {
    return this.getSession(id).runtime.kernel.setModel({ modelId });
  }

  async setAccessLevel(
    id: string,
    accessLevel: RuntimeAccessLevel,
  ): Promise<RuntimeSessionControls> {
    return this.getSession(id).runtime.kernel.setAccessLevel({ accessLevel });
  }

  async close(
    id: string,
    request: {
      cwd?: string | null;
      protocol?: RuntimeProtocol;
    } = {},
  ): Promise<void> {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, request.protocol);
    if (!session) {
      const resolved = await this.resolveSessionInfo({
        id,
        cwd: request.cwd,
        protocol: request.protocol ?? "acp",
      });
      if (!resolved) throw new Error(`Unknown Runtime session: ${id}`);
      this.clearInMemoryHistory(id, resolved.id, resolved.threadId, resolved.externalThreadId);
      return;
    }
    await this.closeActiveSession(session, "close", request.protocol, { cancel: true });
  }

  async closeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const sessionId of Array.from(this.sessions.keys())) {
      try {
        await this.close(sessionId);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.options.threadIndex?.close?.();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, `Failed to close ${errors.length} Runtime sessions.`);
  }

  async delete(
    id: string,
    request: {
      cwd?: string;
      protocol?: RuntimeProtocol;
    } = {},
  ): Promise<void> {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, request.protocol);
    const deletedHistoryIds = new Set<string>([id]);
    if (session) {
      if (request.protocol && session.protocol !== request.protocol) {
        throw new Error(
          `Runtime session ${id} belongs to protocol '${session.protocol}' and cannot delete as '${request.protocol}'.`,
        );
      }
      deletedHistoryIds.add(session.id);
      if (session.threadId) deletedHistoryIds.add(session.threadId);
      if (session.externalThreadId) deletedHistoryIds.add(session.externalThreadId);
      invalidateSessionContinuation(session);
      if (session.threadId)
        await session.runtime.kernel.deleteThreadSession({ threadId: session.threadId });
      try {
        await this.closeActiveSession(session, "delete", request.protocol, {
          cancel: false,
          cleanupOnFailure: Boolean(session.threadId),
        });
      } catch (error) {
        if (session.threadId) this.clearInMemoryHistory(...deletedHistoryIds);
        throw error;
      }
    } else {
      const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
      const protocol = request.protocol ?? "acp";
      const runtime = await this.createListRuntime(cwd, protocol);
      let deletedThread = false;
      try {
        const listedThreads = await this.listThreadSessions(runtime, { cwd, protocol });
        const thread = findThreadForProtocolSession(listedThreads, id, protocol);
        if (thread) {
          const info = threadInfo(thread, { cwd, protocol });
          deletedHistoryIds.add(info.id);
          if (info.threadId) deletedHistoryIds.add(info.threadId);
          if (info.externalThreadId) deletedHistoryIds.add(info.externalThreadId);
        }
        await runtime.kernel.deleteThreadSession({ threadId: thread?.threadId ?? id });
        deletedThread = true;
      } finally {
        if (deletedThread) this.clearInMemoryHistory(...deletedHistoryIds);
        await runtime.close?.();
      }
    }
    this.clearInMemoryHistory(...deletedHistoryIds);
  }

  private async closeActiveSession(
    session: RuntimeProtocolSession<TState, TServices, THarness>,
    operation: "close" | "delete",
    protocol: RuntimeProtocol | undefined,
    options: { cancel: boolean; cleanupOnFailure?: boolean },
  ): Promise<void> {
    if (protocol && session.protocol !== protocol) {
      throw new Error(
        `Runtime session ${session.id} belongs to protocol '${session.protocol}' and cannot ${operation} as '${protocol}'.`,
      );
    }
    let kernelSessionClosed = false;
    try {
      if (options.cancel) cancelKernelSession(session);
      invalidateSessionContinuation(session);
      kernelSessionClosed = await closeKernelSession(session);
      await session.runtime.close?.();
    } catch (error) {
      if (options.cleanupOnFailure || kernelSessionClosed) this.cleanupActiveSession(session);
      throw error;
    }
    this.cleanupActiveSession(session);
  }

  private cleanupActiveSession(session: RuntimeProtocolSession<TState, TServices, THarness>): void {
    session.unsubscribe();
    this.sessions.delete(session.id);
    this.clearInMemoryHistory(session.id, session.threadId, session.externalThreadId);
    if (session.externalThreadId) {
      this.externalThreadIndex.delete(
        externalThreadKey(session.protocol, session.externalThreadId),
      );
    }
  }

  private activeSessionForId(
    id: string,
    protocol: RuntimeProtocol | undefined,
  ): RuntimeProtocolSession<TState, TServices, THarness> | undefined {
    return Array.from(this.sessions.values()).find(
      (session) =>
        (!protocol || session.protocol === protocol) &&
        (session.id === id || session.threadId === id || session.externalThreadId === id),
    );
  }

  private async sourceSession(
    id: string,
    request: {
      cwd?: string;
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession<TState, TServices, THarness>> {
    const session = this.sessions.get(id) ?? this.activeSessionForId(id, request.protocol);
    if (session) return session;
    return this.rehydrateSession(id, request);
  }

  private async rehydrateSession(
    id: string,
    request: {
      cwd?: string;
      additionalDirectories?: string[];
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession<TState, TServices, THarness>> {
    const startedAt = performance.now();
    const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    const protocol = request.protocol ?? "acp";
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories,
      protocol,
    });
    const listedThreads = await this.listThreadSessions(runtime, { cwd, protocol });
    const thread = findThreadForProtocolSession(listedThreads, id, protocol);
    if (!thread) {
      await runtime.close?.();
      throw new Error(`Unknown Runtime session: ${id}`);
    }
    const threadId = thread.threadId ?? id;
    const protocolMetadata = readProtocolThreadMetadata(thread.metadata, protocol);
    const sessionId = protocolMetadata?.protocolSessionId ?? id;
    const kernelSession = await runtime.kernel.resumeThreadSession({
      sessionId,
      threadId,
      resourceId: thread.resourceId,
      title: thread.title,
      protocol,
      externalThreadId: protocolMetadata?.externalThreadId,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    });
    await seedHarnessSandboxAllowedPaths(runtime, metadataSandboxAllowedPaths(thread.metadata));
    const now = new Date().toISOString();
    const session: RuntimeProtocolSession<TState, TServices, THarness> = {
      id: sessionId,
      protocol,
      cwd: runtime.workspace?.cwd ?? cwd,
      additionalDirectories,
      title: thread?.title ?? `${protocol} session`,
      runtime,
      threadId,
      resourceId: kernelSession.resourceId ?? thread.resourceId,
      ...(thread.lock ? { lock: thread.lock } : {}),
      ...(protocolMetadata?.externalThreadId
        ? { externalThreadId: protocolMetadata.externalThreadId }
        : {}),
      createdAt: kernelSession.createdAt ?? thread.createdAt ?? now,
      updatedAt: kernelSession.updatedAt ?? thread.updatedAt ?? now,
      cancelled: false,
      promptActive: false,
      pendingResumeDecisions: [],
      continuationGeneration: 0,
      restoredFromRegistry: false,
      protocolMetadataPersisted: true,
      emitQueue: Promise.resolve(),
      unsubscribe: () => undefined,
    };

    await hydrateSessionLedger(session);
    this.trackSession(session);
    logProtocolTiming("rehydrateSession", startedAt, {
      id,
      sessionId,
      threadId,
      protocol,
    });
    return session;
  }

  private async materializeSession(
    session: RuntimeProtocolSession<TState, TServices, THarness>,
  ): Promise<void> {
    if (session.threadId) {
      if (!session.protocolMetadataPersisted) {
        await persistProtocolThreadMetadata(session);
        session.protocolMetadataPersisted = true;
        this.flushBufferedProtocolEvents(session);
      }
      return;
    }

    const materialized = await session.runtime.kernel.materializeSession(session.id, {
      title: session.title,
    });
    if (!materialized.threadId) throw new Error("Runtime did not materialize a thread id.");

    session.threadId = materialized.threadId;
    session.resourceId = materialized.resourceId ?? session.runtime.kernel.getResourceId();
    session.updatedAt = materialized.updatedAt;
    await persistProtocolThreadMetadata(session);
    session.protocolMetadataPersisted = true;
    this.flushBufferedProtocolEvents(session);
  }

  private async forkMaterializeSession(
    session: RuntimeProtocolSession<TState, TServices, THarness>,
    source: RuntimeProtocolSession<TState, TServices, THarness>,
  ): Promise<void> {
    if (!source.threadId) throw new Error(`Runtime source session ${source.id} is still a draft.`);
    const forked = await session.runtime.kernel.forkSession(session.id, {
      sourceThreadId: source.threadId,
      resourceId: source.resourceId,
      title: session.title,
    });
    if (!forked.threadId) throw new Error("Runtime did not fork a thread id.");

    session.threadId = forked.threadId;
    session.resourceId = forked.resourceId ?? session.runtime.kernel.getResourceId();
    session.updatedAt = forked.updatedAt;
    await persistProtocolThreadMetadata(session);
    session.protocolMetadataPersisted = true;
    this.flushBufferedProtocolEvents(session);
  }

  private async createListRuntime(
    cwd: string,
    protocol: RuntimeProtocol,
  ): Promise<RuntimeHandle<TState, TServices, THarness>> {
    const startedAt = performance.now();
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories: [],
      protocol,
    });
    logProtocolTiming("createListRuntime", startedAt, { protocol, cwd });
    return runtime;
  }

  private async listThreadSessions(
    runtime: RuntimeHandle<TState, TServices, THarness>,
    request: { cwd: string; protocol: RuntimeProtocol },
  ): Promise<RuntimeThreadInfo[]> {
    const startedAt = performance.now();
    const runtimeThreads = await runtime.kernel.listThreadSessions();
    const indexedThreads =
      (await this.options.threadIndex?.listThreadSessions({
        cwd: request.cwd,
        protocol: request.protocol,
      })) ?? [];
    const threads = mergeThreadInfos(runtimeThreads, indexedThreads);
    logProtocolTiming("listThreadSessions", startedAt, {
      protocol: request.protocol,
      runtimeThreads: runtimeThreads.length,
      indexedThreads: indexedThreads.length,
      threads: threads.length,
    });
    return threads;
  }

  private async findSessionByExternalThreadId(
    request: RuntimeCreateProtocolSessionRequest & {
      externalThreadId: string;
    },
  ): Promise<RuntimeProtocolSessionInfo | undefined> {
    return this.resolveSessionInfo({
      id: request.externalThreadId,
      cwd: request.cwd,
      protocol: request.protocol,
    });
  }

  private trackSession(session: RuntimeProtocolSession<TState, TServices, THarness>): void {
    this.sessions.set(session.id, session);
    if (session.externalThreadId) {
      this.externalThreadIndex.set(
        externalThreadKey(session.protocol, session.externalThreadId),
        session.id,
      );
    }
  }

  private appendHistory(id: string, entry: RuntimeSessionHistoryEntry): void {
    this.inMemoryHistory.set(id, [...(this.inMemoryHistory.get(id) ?? []), entry]);
  }

  private clearInMemoryHistory(...ids: Array<string | undefined>): void {
    for (const id of ids) {
      if (id) this.inMemoryHistory.delete(id);
    }
  }

  private kernelHistory(id: string): RuntimeSessionHistoryEntry[] {
    const session = this.sessions.get(id);
    if (!session?.threadId) return [];
    return session.runtime.kernel.snapshotSessionLedger(session.id).flatMap(historyEntryFromLedger);
  }

  private flushBufferedProtocolEvents(
    session: RuntimeProtocolSession<TState, TServices, THarness>,
  ): void {
    if (!session.threadId) return;
    const history = this.inMemoryHistory.get(session.id);
    if (!history?.length) return;

    const remaining: RuntimeSessionHistoryEntry[] = [];
    for (const entry of history) {
      if (entry.type !== "protocol_event") {
        remaining.push(entry);
        continue;
      }
      session.runtime.kernel.recordSessionProtocolEvent(session.id, {
        protocol: entry.protocol,
        payload: entry.payload,
        projection: entry.projection,
      });
    }

    if (remaining.length > 0) this.inMemoryHistory.set(session.id, remaining);
    else this.inMemoryHistory.delete(session.id);
  }
}

function runtimeQueueMessageResultSession(
  result: RuntimeQueueProtocolPromptResult | RuntimeQueueSessionMessageResult,
): RuntimeQueueSessionMessageResult["session"] | undefined {
  return "session" in result ? result.session : undefined;
}

async function sendPromptWithoutQueue<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(
  session: RuntimeProtocolSession<TState, TServices, THarness>,
  message: RuntimeSendMessageOptions,
): Promise<RuntimeQueueProtocolPromptResult> {
  const updated = await session.runtime.kernel.sendSessionMessage(session.id, message);
  session.threadId = updated.threadId ?? session.threadId;
  session.resourceId = updated.resourceId ?? session.resourceId;
  session.updatedAt = updated.updatedAt;
  return { queued: false };
}

async function closeKernelSession<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): Promise<boolean> {
  await session.runtime.kernel.closeSession(session.id);
  return true;
}

function cancelKernelSession<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): void {
  session.runtime.kernel.cancelSession(session.id);
}

async function hydrateSessionLedger<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): Promise<void> {
  await readRuntimeSessionLedger(session);
}

async function readRuntimeSessionLedger<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): Promise<RuntimeLedgerEntry[]> {
  return session.runtime.kernel.readSessionLedger(session.id);
}

async function readRuntimeSessionMessages<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): Promise<RuntimeThreadMessage[]> {
  return session.runtime.kernel.readSessionMessages(session.id);
}

function createPromptContext<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(
  session: RuntimeProtocolSession<TState, TServices, THarness>,
  request: RuntimeSendProtocolPromptRequest,
): RuntimeContextEntry[] | undefined {
  const resourceEntries = createRuntimeResourceContextEntries({
    scope: createRuntimeResourceScope({
      cwd: session.cwd,
      additionalDirectories: sessionAdditionalDirectories(session),
    }),
    resources: request.resources,
  });
  const resumeEntries = createRuntimeResumeContextEntries(request.resumeDecisions);
  const context = [...(request.context ?? []), ...resourceEntries, ...resumeEntries];
  return context.length > 0 ? context : undefined;
}

function refreshSessionListedThreadState<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(
  session: RuntimeProtocolSession<TState, TServices, THarness>,
  thread: RuntimeThreadInfo | undefined,
): RuntimeProtocolSession<TState, TServices, THarness> {
  if (!thread) return session;
  if (thread.lock) session.lock = thread.lock;
  else delete session.lock;
  return session;
}

export function sessionInfo<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): RuntimeProtocolSessionInfo {
  return {
    id: session.id,
    protocol: session.protocol,
    cwd: session.cwd,
    additionalDirectories: sessionAdditionalDirectories(session),
    title: session.title,
    ...(session.threadId ? { threadId: session.threadId } : {}),
    ...(session.resourceId ? { resourceId: session.resourceId } : {}),
    ...(session.lock
      ? { lock: session.lock }
      : session.threadId
        ? { lock: { status: "owned", ownerPid: process.pid } as const }
        : {}),
    ...(session.externalThreadId ? { externalThreadId: session.externalThreadId } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    promptActive: session.promptActive,
  };
}

function sessionAdditionalDirectories<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): string[] {
  const harnessState = harnessSandboxState(session.runtime);
  return normalizeAdditionalDirectories([
    ...session.additionalDirectories,
    ...(harnessState?.sandboxAllowedPaths ?? []),
  ]);
}

function harnessSandboxState<
  TState extends Record<string, unknown>,
  THarness extends RuntimeHandleHarness<TState>,
>(
  runtime: RuntimeHandle<TState, RuntimeHandleServices, THarness>,
): { sandboxAllowedPaths?: string[] } | undefined {
  const state = readRecord(runtime.harness.getState());
  const sandboxAllowedPaths = state.sandboxAllowedPaths;
  return Array.isArray(sandboxAllowedPaths) ? { sandboxAllowedPaths } : undefined;
}

function harnessSandboxAllowedPaths<
  TState extends Record<string, unknown>,
  THarness extends RuntimeHandleHarness<TState>,
>(runtime: RuntimeHandle<TState, RuntimeHandleServices, THarness>): string[] {
  return normalizeOptionalSandboxPaths(harnessSandboxState(runtime)?.sandboxAllowedPaths);
}

async function seedHarnessSandboxAllowedPaths<
  TState extends Record<string, unknown>,
  THarness extends RuntimeHandleHarness<TState>,
>(
  runtime: RuntimeHandle<TState, RuntimeHandleServices, THarness>,
  sandboxAllowedPaths: string[],
): Promise<void> {
  if (sandboxAllowedPaths.length === 0) return;
  await runtime.harness.setState({ ...runtime.harness.getState(), sandboxAllowedPaths });
}

function metadataSandboxAllowedPaths(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.sandboxAllowedPaths;
  return Array.isArray(value) ? normalizeOptionalSandboxPaths(value) : [];
}

function normalizeOptionalSandboxPaths(paths: readonly unknown[] | undefined): string[] {
  if (!paths) return [];
  return normalizeAdditionalDirectories(
    paths.filter((entry): entry is string => typeof entry === "string"),
  );
}

function mergeThreadInfos(...sources: RuntimeThreadInfo[][]): RuntimeThreadInfo[] {
  const merged = new Map<string, RuntimeThreadInfo>();
  for (const source of sources) {
    for (const thread of source) {
      const key = `${thread.resourceId}:${thread.threadId}`;
      if (!merged.has(key)) merged.set(key, thread);
    }
  }
  return Array.from(merged.values());
}

function threadInfo(
  thread: RuntimeThreadInfo,
  options: { cwd: string; protocol: RuntimeProtocol },
): RuntimeProtocolSessionInfo {
  const protocolMetadata = readProtocolThreadMetadata(thread.metadata, options.protocol);
  return {
    id: protocolMetadata?.protocolSessionId ?? thread.threadId,
    protocol: options.protocol,
    cwd: normalizeCwd(thread.cwd ?? options.cwd),
    additionalDirectories: [],
    title: thread.title ?? `${options.protocol} session`,
    threadId: thread.threadId,
    resourceId: thread.resourceId,
    ...(thread.lock ? { lock: thread.lock } : {}),
    ...(protocolMetadata?.externalThreadId
      ? { externalThreadId: protocolMetadata.externalThreadId }
      : {}),
    createdAt: thread.createdAt ?? new Date(0).toISOString(),
    updatedAt: thread.updatedAt ?? thread.createdAt ?? new Date(0).toISOString(),
    promptActive: false,
  };
}

function sessionMatchesId(session: RuntimeProtocolSessionInfo, id: string): boolean {
  return session.id === id || session.threadId === id || session.externalThreadId === id;
}

function findThreadForProtocolSession(
  threads: RuntimeThreadInfo[],
  id: string,
  protocol: RuntimeProtocol,
): RuntimeThreadInfo | undefined {
  return (
    threads.find((thread) => thread.threadId === id) ??
    threads.find(
      (thread) => readProtocolThreadMetadata(thread.metadata, protocol)?.protocolSessionId === id,
    ) ??
    threads.find(
      (thread) => readProtocolThreadMetadata(thread.metadata, protocol)?.externalThreadId === id,
    )
  );
}

function normalizeCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  if (!path.isAbsolute(resolved)) throw new Error(`Runtime cwd must be absolute: ${cwd}`);
  return resolved;
}

function normalizeAdditionalDirectories(additionalDirectories: string[]): string[] {
  return Array.from(
    new Set(
      additionalDirectories.map((directory) => {
        const resolved = path.resolve(directory);
        if (!path.isAbsolute(resolved))
          throw new Error(`Runtime additional directory must be absolute: ${directory}`);
        return resolved;
      }),
    ),
  );
}

function externalThreadKey(protocol: RuntimeProtocol, externalThreadId: string): string {
  return `${protocol}:${externalThreadId}`;
}

function sanitizeHistoryPayload(payload: unknown): RuntimeJsonValue {
  return sanitizeJson(payload);
}

function historyEntryFromLedger(entry: RuntimeLedgerEntry): RuntimeSessionHistoryEntry[] {
  if (entry.type === "user_prompt") {
    return [
      {
        type: "prompt",
        content: entry.content,
        createdAt: entry.createdAt,
      },
    ];
  }

  if (entry.type === "protocol_event") {
    return [
      {
        type: "protocol_event",
        protocol: entry.protocol,
        payload: entry.payload,
        projection: entry.projection,
        createdAt: entry.createdAt,
      },
    ];
  }

  return [];
}

function invalidateSessionContinuation<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): void {
  session.cancelled = true;
  session.pendingResumeDecisions = [];
  session.continuationGeneration += 1;
}

async function persistProtocolThreadMetadata<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(session: RuntimeProtocolSession<TState, TServices, THarness>): Promise<void> {
  if (!session.threadId) return;
  const setThreadSetting = session.runtime.harness.setThreadSetting?.bind(session.runtime.harness);
  if (!setThreadSetting) return;

  const metadata: RuntimeProtocolThreadMetadata = {
    protocol: session.protocol,
    protocolSessionId: session.id,
    ...(session.externalThreadId ? { externalThreadId: session.externalThreadId } : {}),
  };
  await setThreadSetting({
    key: protocolThreadMetadataKey,
    value: metadata,
  });
}

function readProtocolThreadMetadata(
  metadata: Record<string, unknown> | undefined,
  protocol: RuntimeProtocol,
): RuntimeProtocolThreadMetadata | undefined {
  const value = metadata?.[protocolThreadMetadataKey];
  if (!isProtocolThreadMetadata(value) || value.protocol !== protocol) return undefined;
  return value;
}

function isProtocolThreadMetadata(value: unknown): value is RuntimeProtocolThreadMetadata {
  if (Array.isArray(value)) return false;
  const record = readRecord(value);
  return (
    typeof record.protocol === "string" &&
    (record.protocolSessionId === undefined || typeof record.protocolSessionId === "string") &&
    (record.externalThreadId === undefined || typeof record.externalThreadId === "string")
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logProtocolTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown>,
): void {
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs < 100) return;
  console.info("[session timing]", label, { elapsedMs, ...details });
}

function mergeResumeDecisions(
  pending: RuntimeResumeDecision[],
  supplied: RuntimeResumeDecision[] | undefined,
): RuntimeResumeDecision[] | undefined {
  const merged = [...pending, ...(supplied ?? [])];
  return merged.length > 0 ? merged : undefined;
}
