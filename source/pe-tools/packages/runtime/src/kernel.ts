import { createHash, randomUUID } from "node:crypto";
import type { Harness, HarnessEvent } from "@mastra/core/harness";
import { createRuntimeRequestContext, setRuntimeThreadSettings } from "./context.ts";
import { MastraHarnessToRuntimeEvents, sanitizeJson, type RuntimeEvent } from "./events.ts";
import { readRuntimeThreadLockInfo } from "./harness/thread-lock.ts";
import type {
  RuntimeForkSessionOptions,
  RuntimeCreateDraftSessionOptions,
  RuntimeKernel,
  RuntimeKernelSession,
  RuntimeLedgerEntry,
  RuntimeQueueMessageResult,
  RuntimeQueueSessionMessageResult,
  RuntimeReadThreadRequest,
  RuntimeRecordProtocolEventRequest,
  RuntimeResumeThreadSessionOptions,
  RuntimeQueueDecision,
  RuntimeSendMessageOptions,
  RuntimeAccessLevel,
  RuntimeSessionControls,
  RuntimeThreadInfo,
  RuntimeThreadMessage,
  RuntimeThreadSession,
} from "./runtime.ts";
import type { RuntimeStorageProfileKind } from "./storage/profiles.ts";
import type { RuntimeThreadStateStore } from "./storage/thread-state.ts";
import type { RuntimeToolSource } from "./tool-metadata.ts";

export type RuntimeKernelContextProvider = (request: {
  threadId?: string;
}) => Promise<string> | string;

export interface RuntimeKernelOptions {
  agentOverrides?: Record<string, unknown>;
  contextProvider?: RuntimeKernelContextProvider;
  contextFailureFormatter?: (error: unknown) => string;
  threadStateStore?: RuntimeThreadStateStore;
  storageProfileKind?: RuntimeStorageProfileKind;
  toolCatalog?: RuntimeToolSource;
}

type RuntimeLedgerEntryInput = {
  [K in RuntimeLedgerEntry["type"]]: Omit<
    Extract<RuntimeLedgerEntry, { type: K }>,
    "sequence" | "createdAt"
  > & {
    createdAt?: string;
  };
}[RuntimeLedgerEntry["type"]];

export function createRuntimeKernel(
  harness: Harness<Record<string, unknown>>,
  options: RuntimeKernelOptions = {},
): RuntimeKernel {
  return new MastraRuntimeKernel(harness, options);
}

class MastraRuntimeKernel implements RuntimeKernel {
  private readonly agentOverrides: Record<string, unknown>;
  private readonly sessions = new Map<string, RuntimeKernelSession>();
  private readonly ledger: RuntimeLedgerEntry[] = [];
  private readonly hydratedPersistedLedgerKeys = new Set<string>();
  private sequence = 0;
  private initTask: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private persistFailure: { error: unknown } | null = null;

  constructor(
    private readonly harness: Harness<Record<string, unknown>>,
    private readonly options: RuntimeKernelOptions,
  ) {
    this.agentOverrides = options.agentOverrides ?? {};
  }

  async initialize(): Promise<void> {
    this.initTask ??= (async () => {
      const initializable = this.harness as unknown as {
        init?: () => Promise<void> | void;
        getMastra?: () =>
          | {
              getAgentById?: (id: string) => unknown;
              startWorkers?: () => Promise<void> | void;
            }
          | undefined;
      };
      await initializable.init?.();
      const mastra = initializable.getMastra?.();
      if (mastra && Object.keys(this.agentOverrides).length > 0) {
        const getAgentById = mastra.getAgentById?.bind(mastra);
        mastra.getAgentById = (id: string) => this.agentOverrides[id] ?? getAgentById?.(id);
      }
      await mastra?.startWorkers?.();
    })();
    await this.initTask;
  }

  createDraftSession(options: RuntimeCreateDraftSessionOptions = {}): RuntimeKernelSession {
    const now = new Date().toISOString();
    const session: RuntimeKernelSession = {
      sessionId: `draft:${randomUUID()}`,
      status: "draft",
      title: options.title,
      protocol: options.protocol,
      externalThreadId: options.externalThreadId,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.sessionId, session);
    return cloneKernelSession(session);
  }

  readSession(sessionId: string): RuntimeKernelSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? cloneKernelSession(session) : undefined;
  }

  readThreadSession(options: { threadId: string }): RuntimeKernelSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.status === "materialized" && session.threadId === options.threadId) {
        return cloneKernelSession(session);
      }
    }
    return undefined;
  }

  listSessions(): RuntimeKernelSession[] {
    return Array.from(this.sessions.values(), cloneKernelSession);
  }

  async materializeSession(
    sessionId: string,
    options: { title?: string } = {},
  ): Promise<RuntimeKernelSession> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    if (existing.status === "materialized") return cloneKernelSession(existing);
    this.assertThreadCreationIsIdle("materializeSession");

    const thread = await this.createThreadSession({
      title: options.title ?? existing.title ?? "New thread",
    });
    const updated: RuntimeKernelSession = {
      ...existing,
      status: "materialized",
      threadId: thread.threadId,
      resourceId: thread.resourceId,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, updated);
    this.recordSessionIdentity(updated);
    return cloneKernelSession(updated);
  }

  async forkSession(
    sessionId: string,
    options: RuntimeForkSessionOptions,
  ): Promise<RuntimeKernelSession> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    if (existing.status === "materialized") return cloneKernelSession(existing);
    this.assertThreadCreationIsIdle("forkSession");

    const thread = await this.cloneThreadSession(options);
    const updated: RuntimeKernelSession = {
      ...existing,
      status: "materialized",
      threadId: thread.threadId,
      resourceId: thread.resourceId,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, updated);
    this.recordSessionIdentity(updated);
    return cloneKernelSession(updated);
  }

  async resumeThreadSession(
    options: RuntimeResumeThreadSessionOptions,
  ): Promise<RuntimeKernelSession> {
    if (this.harness.getCurrentThreadId() !== options.threadId) {
      if (isHarnessRunning(this.harness)) {
        throw new Error(
          "Runtime resumeThreadSession can only target the active thread while running.",
        );
      }
      await this.switchThread({ threadId: options.threadId });
    }
    this.assertSessionCanResumeThread(options);
    this.assertThreadSessionOwner(options.threadId, options.sessionId, "resumeThreadSession");
    const now = new Date().toISOString();
    const existing = this.sessions.get(options.sessionId);
    const session: RuntimeKernelSession = {
      sessionId: options.sessionId,
      status: "materialized",
      threadId: options.threadId,
      resourceId: options.resourceId ?? this.harness.getResourceId(),
      title: options.title ?? existing?.title,
      protocol: options.protocol ?? existing?.protocol,
      externalThreadId: options.externalThreadId ?? existing?.externalThreadId,
      createdAt: existing?.createdAt ?? options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
    };
    this.sessions.set(options.sessionId, session);
    this.recordSessionIdentity(session);
    return cloneKernelSession(session);
  }

  private recordSessionIdentity(session: RuntimeKernelSession): void {
    if (session.status !== "materialized" || !session.threadId || !session.resourceId) return;
    if (this.hasMatchingSessionIdentityEntry(session)) return;

    this.appendLedger({
      type: "session_identity",
      threadId: session.threadId,
      resourceId: session.resourceId,
      sessionId: session.sessionId,
      status: session.status,
      title: session.title,
      protocol: session.protocol,
      externalThreadId: session.externalThreadId,
      provenance: { source: "kernel" },
    });
  }

  private hasMatchingSessionIdentityEntry(session: RuntimeKernelSession): boolean {
    return this.ledger.some(
      (entry) =>
        entry.type === "session_identity" &&
        entry.threadId === session.threadId &&
        entry.resourceId === session.resourceId &&
        entry.sessionId === session.sessionId &&
        entry.status === session.status &&
        entry.title === session.title &&
        entry.protocol === session.protocol &&
        entry.externalThreadId === session.externalThreadId,
    );
  }

  private assertSessionCanResumeThread(options: RuntimeResumeThreadSessionOptions): void {
    const existing = this.sessions.get(options.sessionId);
    if (!existing) return;

    if (
      existing.status === "materialized" &&
      existing.threadId &&
      existing.threadId !== options.threadId
    ) {
      throw new Error(
        `Runtime resumeThreadSession cannot move session ${options.sessionId} from thread ${existing.threadId} to thread ${options.threadId}.`,
      );
    }

    if (existing.protocol && options.protocol && existing.protocol !== options.protocol) {
      throw new Error(
        `Runtime resumeThreadSession cannot change session ${options.sessionId} protocol from ${existing.protocol} to ${options.protocol}.`,
      );
    }

    if (
      existing.externalThreadId &&
      options.externalThreadId &&
      existing.externalThreadId !== options.externalThreadId
    ) {
      throw new Error(
        `Runtime resumeThreadSession cannot change session ${options.sessionId} external thread from ${existing.externalThreadId} to ${options.externalThreadId}.`,
      );
    }
  }

  private assertThreadSessionOwner(threadId: string, sessionId: string, operation: string): void {
    for (const session of this.sessions.values()) {
      if (
        session.status === "materialized" &&
        session.threadId === threadId &&
        session.sessionId !== sessionId
      ) {
        throw new Error(
          `Runtime ${operation} cannot attach thread ${threadId} to multiple sessions.`,
        );
      }
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    this.assertSessionCanClose(this.sessions.get(sessionId));
    await this.flushLedger();
    this.sessions.delete(sessionId);
  }

  private assertSessionCanClose(session: RuntimeKernelSession | undefined): void {
    if (session?.status !== "materialized" || !isHarnessRunning(this.harness)) return;
    const currentThreadId = this.harness.getCurrentThreadId();
    if (!currentThreadId || currentThreadId === session.threadId) {
      throw new Error("Runtime closeSession cannot close the active thread while running.");
    }
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    }
    if (session.status === "draft") return;
    if (
      session.status === "materialized" &&
      isHarnessRunning(this.harness) &&
      this.harness.getCurrentThreadId() !== session.threadId
    ) {
      throw new Error("Runtime cancelSession can only target the active thread.");
    }
    this.abort();
  }

  async sendSessionMessage(
    sessionId: string,
    options: RuntimeSendMessageOptions,
  ): Promise<RuntimeKernelSession> {
    const session = await this.materializeSession(sessionId);
    this.assertSessionCanBecomeCurrent(session, "sendSessionMessage");
    if (session.threadId && this.harness.getCurrentThreadId() !== session.threadId) {
      await this.switchThread({ threadId: session.threadId });
    }
    const { threadId: _threadId, resourceId: _resourceId, ...messageOptions } = options;
    await this.sendMessage({
      ...messageOptions,
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
    return cloneKernelSession(this.sessions.get(sessionId) ?? session);
  }

  async queueSessionMessage(
    sessionId: string,
    options: RuntimeSendMessageOptions,
  ): Promise<RuntimeQueueSessionMessageResult> {
    const session = await this.materializeSession(sessionId);
    this.assertSessionCanBecomeCurrent(session, "queueSessionMessage");
    if (session.threadId && this.harness.getCurrentThreadId() !== session.threadId) {
      await this.switchThread({ threadId: session.threadId });
    }
    const { threadId: _threadId, resourceId: _resourceId, ...messageOptions } = options;
    const result = await this.queueMessage({
      ...messageOptions,
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
    return { ...result, session: cloneKernelSession(this.sessions.get(sessionId) ?? session) };
  }

  private assertThreadCreationIsIdle(
    operation: "materializeSession" | "forkSession" | "createThreadSession" | "cloneThreadSession",
  ): void {
    if (isHarnessRunning(this.harness)) {
      throw new Error(`Runtime ${operation} can only create a thread while idle.`);
    }
  }

  private assertSessionCanBecomeCurrent(
    session: RuntimeKernelSession,
    operation: "sendSessionMessage" | "queueSessionMessage",
  ): void {
    if (
      session.status === "materialized" &&
      session.threadId &&
      isHarnessRunning(this.harness) &&
      this.harness.getCurrentThreadId() !== session.threadId
    ) {
      throw new Error(`Runtime ${operation} can only target the active thread while running.`);
    }
  }

  async createThreadSession(options?: { title?: string }): Promise<RuntimeThreadSession> {
    this.assertThreadCreationIsIdle("createThreadSession");
    await this.initialize();
    const thread = (await this.harness.createThread(options)) as { id?: string };
    const threadId = thread.id;
    if (!threadId) throw new Error("Harness did not return a thread id.");
    return {
      threadId,
      resourceId: this.harness.getResourceId(),
    };
  }

  async cloneThreadSession(options: RuntimeForkSessionOptions): Promise<RuntimeThreadSession> {
    this.assertThreadCreationIsIdle("cloneThreadSession");
    await this.initialize();
    const cloneThread = (this.harness as CloneThreadHarness).cloneThread?.bind(this.harness);
    if (!cloneThread) throw new Error("Runtime harness does not support thread cloning.");
    const thread = await cloneThread({
      sourceThreadId: options.sourceThreadId,
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      ...(options.title ? { title: options.title } : {}),
    });
    const threadId = thread.id;
    if (!threadId) throw new Error("Harness did not return a cloned thread id.");
    return {
      threadId,
      resourceId: thread.resourceId ?? this.harness.getResourceId(),
    };
  }

  async switchThread(options: { threadId: string }): Promise<void> {
    await this.initialize();
    if (isHarnessRunning(this.harness) && this.harness.getCurrentThreadId() !== options.threadId) {
      throw new Error("Runtime switchThread can only target the active thread while running.");
    }
    await this.harness.switchThread(options);
  }

  async listThreadSessions(): Promise<RuntimeThreadInfo[]> {
    await this.initialize();
    return (await this.harness.listThreads()).map((thread) => ({
      threadId: thread.id,
      resourceId: thread.resourceId,
      title: thread.title,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      lock: readRuntimeThreadLockInfo(thread.id, {
        storageProfileKind: this.options.storageProfileKind,
      }),
      metadata: thread.metadata,
    }));
  }

  async readThreadMessages(options: RuntimeReadThreadRequest): Promise<RuntimeThreadMessage[]> {
    await this.hydrateThreadLedger(options);
    return this.threadLedger(options).flatMap((entry) =>
      entry.type === "thread_message" ? [entry.message] : [],
    );
  }

  async readThreadLedger(options: RuntimeReadThreadRequest): Promise<RuntimeLedgerEntry[]> {
    await this.hydrateThreadLedger(options);
    return this.threadLedger(options);
  }

  async readSessionMessages(sessionId: string): Promise<RuntimeThreadMessage[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    if (session.status === "draft") return [];
    if (!session.threadId) throw new Error(`Runtime kernel session ${sessionId} has no thread.`);

    return this.readThreadMessages({
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
  }

  async readSessionLedger(sessionId: string): Promise<RuntimeLedgerEntry[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    if (session.status === "draft") return [];
    if (!session.threadId) throw new Error(`Runtime kernel session ${sessionId} has no thread.`);

    return this.readThreadLedger({
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
  }

  async deleteThreadSession(options: { threadId: string }): Promise<void> {
    await this.initialize();
    this.assertThreadCanBeDeleted(options.threadId);
    const memory = (
      this.harness as unknown as {
        memory?: { deleteThread?: (options: { threadId: string }) => Promise<void> | void };
      }
    ).memory;
    if (!memory?.deleteThread) throw new Error("Runtime memory is not configured.");
    await memory.deleteThread(options);
    await this.deleteThreadLedger(options.threadId);
  }

  private assertThreadCanBeDeleted(threadId: string): void {
    if (isHarnessRunning(this.harness)) {
      const currentThreadId = this.harness.getCurrentThreadId();
      if (!currentThreadId || currentThreadId === threadId) {
        throw new Error(
          "Runtime deleteThreadSession cannot delete the active thread while running.",
        );
      }
    }
  }

  getResourceId(): string {
    return this.harness.getResourceId();
  }

  readControls(): RuntimeSessionControls {
    return runtimeControlsFromState(this.harness.getState());
  }

  async setModel(options: { modelId: string }): Promise<RuntimeSessionControls> {
    await this.initialize();
    await this.harness.setState({ currentModelId: options.modelId });
    return this.readControls();
  }

  async setAccessLevel(options: {
    accessLevel: RuntimeAccessLevel;
  }): Promise<RuntimeSessionControls> {
    await this.initialize();
    await this.harness.setState({
      accessLevel: options.accessLevel,
      yolo: options.accessLevel === "trusted",
    });
    return this.readControls();
  }

  recordUserPrompt(options: RuntimeSendMessageOptions): RuntimeLedgerEntry {
    const target = this.validateActiveTarget(options, "recordUserPrompt");
    return this.appendUserPrompt({ ...options, ...target });
  }

  recordProtocolEvent(options: RuntimeRecordProtocolEventRequest): RuntimeLedgerEntry {
    const target = this.validateActiveTarget(options, "recordProtocolEvent");
    return this.appendProtocolEvent(options, target);
  }

  recordSessionProtocolEvent(
    sessionId: string,
    options: Pick<RuntimeRecordProtocolEventRequest, "protocol" | "payload" | "projection">,
  ): RuntimeLedgerEntry {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    if (session.status !== "materialized" || !session.threadId || !session.resourceId) {
      throw new Error(`Runtime kernel session ${sessionId} is still a draft.`);
    }
    return this.appendProtocolEvent(options, {
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
  }

  private appendProtocolEvent(
    options: Pick<RuntimeRecordProtocolEventRequest, "protocol" | "payload" | "projection">,
    target: { threadId: string; resourceId: string },
  ): RuntimeLedgerEntry {
    return this.appendLedger({
      type: "protocol_event",
      threadId: target.threadId,
      resourceId: target.resourceId,
      protocol: options.protocol,
      payload: sanitizeJson(options.payload),
      projection: options.projection,
      provenance: { source: "projection" },
    });
  }

  recordQueueEvent(
    decision: RuntimeQueueDecision,
    options: RuntimeSendMessageOptions,
  ): RuntimeLedgerEntry {
    return this.appendLedger({
      type: "queue_event",
      threadId: options.threadId ?? this.harness.getCurrentThreadId() ?? undefined,
      resourceId: options.resourceId ?? this.harness.getResourceId(),
      decision,
      content: options.content,
      protocol: options.protocol,
      protocolSessionId: options.protocolSessionId,
      provenance: { source: "kernel" },
    });
  }

  snapshotSessionLedger(sessionId: string): RuntimeLedgerEntry[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown runtime kernel session: ${sessionId}`);
    if (session.status === "draft") return [];
    if (!session.threadId) throw new Error(`Runtime kernel session ${sessionId} has no thread.`);

    return this.snapshotLedger({
      threadId: session.threadId,
      resourceId: session.resourceId,
    });
  }

  snapshotLedger(options: { threadId?: string; resourceId?: string } = {}): RuntimeLedgerEntry[] {
    return this.ledger.filter((entry) => matchesThread(entry, options)).map(cloneLedgerEntry);
  }

  async flushLedger(): Promise<void> {
    let queueRejected = false;
    try {
      await this.persistQueue;
    } catch {
      queueRejected = true;
    }

    const failure = this.persistFailure;
    if (failure) {
      this.persistFailure = null;
      if (queueRejected) this.persistQueue = Promise.resolve();
      throw failure.error;
    }
  }

  async sendMessage(options: RuntimeSendMessageOptions): Promise<void> {
    await this.initialize();
    const target = this.validateActiveTarget(options, "sendMessage");
    const messageOptions = { ...options, ...target };
    const requestContext = await this.createSendRequestContext(messageOptions);
    installRuntimeThreadSettings(requestContext, this.harness);
    const promptEntry = this.appendUserPrompt(messageOptions, { persist: false });
    try {
      await this.harness.sendMessage({ content: messageOptions.content, requestContext });
      this.persistLedgerEntry(promptEntry);
    } catch (error) {
      this.removeLedgerEntry(promptEntry);
      throw error;
    }
  }

  async queueMessage(options: RuntimeSendMessageOptions): Promise<RuntimeQueueMessageResult> {
    await this.initialize();
    const target = this.validateActiveTarget(options, "queueMessage");
    const followUpMessage = isHarnessRunning(this.harness)
      ? requireFollowUp(this.harness)
      : undefined;
    const messageOptions = { ...options, ...target };
    const requestContext = await this.createSendRequestContext(messageOptions);
    installRuntimeThreadSettings(requestContext, this.harness);

    if (followUpMessage) {
      const promptEntry = this.appendUserPrompt(messageOptions, { persist: false });
      try {
        await followUpMessage({ content: messageOptions.content, requestContext });
        this.persistLedgerEntry(promptEntry);
      } catch (error) {
        this.removeLedgerEntry(promptEntry);
        throw error;
      }
      this.recordQueueEvent("queued_follow_up", messageOptions);
      return { queued: true };
    }

    const promptEntry = this.appendUserPrompt(messageOptions, { persist: false });
    try {
      await this.harness.sendMessage({ content: messageOptions.content, requestContext });
      this.persistLedgerEntry(promptEntry);
    } catch (error) {
      this.removeLedgerEntry(promptEntry);
      throw error;
    }
    this.recordQueueEvent("sent_immediately", messageOptions);
    return { queued: false };
  }

  abort(): void {
    this.harness.abort();
  }

  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void {
    const translator = new MastraHarnessToRuntimeEvents({
      toolCatalog: this.options.toolCatalog,
    });
    return this.harness.subscribe((event: HarnessEvent) => {
      const rawEntry = this.recordRawMastraEvent(event);
      for (const runtimeEvent of translator.translate(event)) {
        const runtimeEntry = this.recordRuntimeEvent(runtimeEvent, rawEntry);
        void runtimeEntry;
        void listener(runtimeEvent);
      }
    });
  }

  private async createSendRequestContext(
    options: RuntimeSendMessageOptions,
  ): Promise<ReturnType<typeof createRuntimeRequestContext>> {
    const threadId = options.threadId ?? this.harness.getCurrentThreadId() ?? undefined;
    const resourceId = options.resourceId ?? this.harness.getResourceId();
    const promptFragments = await collectSessionPromptFragments(
      this.options.contextProvider,
      threadId,
      this.options.contextFailureFormatter,
    );
    return createRuntimeRequestContext({
      protocol: options.protocol ?? "tui",
      protocolSessionId: options.protocolSessionId,
      threadId,
      resourceId,
      entries: options.context,
      promptFragments,
      resumeDecisions: options.resumeDecisions,
    });
  }

  private validateActiveTarget(
    options: { threadId?: string; resourceId?: string },
    operation: "sendMessage" | "queueMessage" | "recordUserPrompt" | "recordProtocolEvent",
  ): { threadId: string; resourceId: string } {
    const currentThreadId = this.harness.getCurrentThreadId() ?? undefined;
    const currentResourceId = this.harness.getResourceId();
    const threadId = options.threadId ?? currentThreadId;
    const resourceId = options.resourceId ?? currentResourceId;

    if (!threadId) {
      throw new Error(`Runtime ${operation} requires an active thread.`);
    }

    if (threadId !== currentThreadId || resourceId !== currentResourceId) {
      throw new Error(`Runtime ${operation} can only target the active thread.`);
    }

    return { threadId, resourceId };
  }

  private async hydrateThreadLedger(options: RuntimeReadThreadRequest): Promise<void> {
    await this.initialize();

    await this.hydratePersistedLedger(options);
    const messages = await this.recallThreadMessages(options);
    for (const message of messages) {
      if (!message.text) continue;
      if (this.hasThreadMessage(options, message)) continue;
      this.appendLedger({
        type: "thread_message",
        threadId: options.threadId,
        resourceId: options.resourceId,
        createdAt: message.createdAt,
        message,
        provenance: { source: "memory" },
      });
    }
  }

  private async recallThreadMessages(
    options: RuntimeReadThreadRequest,
  ): Promise<RuntimeThreadMessage[]> {
    const resolvedMemory = await resolveHarnessMemory(this.harness);
    const result = await resolvedMemory.recall({
      threadId: options.threadId,
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      page: 0,
      perPage: false,
      orderBy: { field: "createdAt", direction: "ASC" },
    });
    const messages = Array.isArray(result.messages) ? result.messages : [];
    return messages.map(runtimeThreadMessage).filter((message) => message.text.length > 0);
  }

  private threadLedger(options: RuntimeReadThreadRequest): RuntimeLedgerEntry[] {
    return this.snapshotLedger(options);
  }

  private async hydratePersistedLedger(options: RuntimeReadThreadRequest): Promise<void> {
    const store = this.options.threadStateStore;
    if (!store) return;

    await this.flushLedger();
    const key = threadKey(options);
    if (this.hydratedPersistedLedgerKeys.has(key)) return;

    const state = await store.getState<RuntimePersistedLedgerState>({
      threadId: options.threadId,
      type: runtimeLedgerThreadStateType,
    });
    for (const entry of persistedLedgerEntries(state)) {
      if (matchesThread(entry, options) && !this.hasLedgerEntry(entry)) {
        this.ledger.push(entry);
        this.sequence = Math.max(this.sequence, entry.sequence);
      }
    }
    this.hydratedPersistedLedgerKeys.add(key);
  }

  private async deleteThreadLedger(threadId: string): Promise<void> {
    await this.flushLedger();

    const threadStateStore = this.options.threadStateStore as
      | {
          deleteState?: (args: { threadId: string; type: string }) => Promise<void> | void;
        }
      | undefined;
    await threadStateStore?.deleteState?.({
      threadId,
      type: runtimeLedgerThreadStateType,
    });

    const retainedEntries = this.ledger.filter((entry) => entry.threadId !== threadId);
    this.ledger.splice(0, this.ledger.length, ...retainedEntries);
    for (const key of Array.from(this.hydratedPersistedLedgerKeys)) {
      if (key.endsWith(`:${threadId}`)) this.hydratedPersistedLedgerKeys.delete(key);
    }
    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      if (session.threadId === threadId) this.sessions.delete(sessionId);
    }
  }

  private recordRawMastraEvent(event: HarnessEvent): RuntimeLedgerEntry {
    const record = readRecord(event);
    const threadId = stringValue(record.threadId) ?? this.harness.getCurrentThreadId() ?? undefined;
    const resourceId = stringValue(record.resourceId) ?? this.harness.getResourceId();
    return this.appendLedger({
      type: "raw_mastra_event",
      threadId,
      resourceId,
      rawEventType: stringValue(record.type),
      rawEvent: sanitizeJson(event),
    });
  }

  private recordRuntimeEvent(
    event: RuntimeEvent,
    rawEntry: RuntimeLedgerEntry,
  ): RuntimeLedgerEntry {
    return this.appendLedger({
      type: "runtime_event",
      threadId: rawEntry.threadId,
      resourceId: rawEntry.resourceId,
      event,
      provenance: {
        source: "mastra",
        rawEventSequence: rawEntry.sequence,
        rawEventType: rawEntry.type === "raw_mastra_event" ? rawEntry.rawEventType : undefined,
      },
    });
  }

  private appendUserPrompt(
    options: RuntimeSendMessageOptions & { threadId: string; resourceId: string },
    config: { persist?: boolean } = {},
  ): RuntimeLedgerEntry {
    return this.appendLedger(
      {
        type: "user_prompt",
        threadId: options.threadId,
        resourceId: options.resourceId,
        content: options.content,
        protocol: options.protocol,
        protocolSessionId: options.protocolSessionId,
        provenance: { source: "kernel" },
      },
      config,
    );
  }

  private appendLedger(
    entry: RuntimeLedgerEntryInput,
    config: { persist?: boolean } = {},
  ): RuntimeLedgerEntry {
    const createdAt = entry.createdAt ?? new Date().toISOString();
    const ledgerEntry = {
      ...entry,
      createdAt,
      sequence: ++this.sequence,
    } as RuntimeLedgerEntry;
    this.ledger.push(ledgerEntry);
    if (config.persist !== false) this.persistLedgerEntry(ledgerEntry);
    return cloneLedgerEntry(ledgerEntry);
  }

  private removeLedgerEntry(entry: RuntimeLedgerEntry): void {
    const key = ledgerEntryKey(entry);
    const index = this.ledger.findIndex((candidate) => ledgerEntryKey(candidate) === key);
    if (index >= 0) this.ledger.splice(index, 1);
  }

  private persistLedgerEntry(entry: RuntimeLedgerEntry): void {
    const store = this.options.threadStateStore;
    if (!store || !isPersistedLedgerEntry(entry)) return;

    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        const existing = await store.getState<RuntimePersistedLedgerState>({
          threadId: entry.threadId,
          type: runtimeLedgerThreadStateType,
        });
        const existingEntries = persistedLedgerEntries(existing);
        const entries = [...existingEntries];
        const entryKeys = new Set(entries.map(ledgerEntryKey));
        for (const candidate of this.ledger) {
          if (!isPersistedLedgerEntry(candidate) || candidate.threadId !== entry.threadId) continue;
          const key = ledgerEntryKey(candidate);
          if (entryKeys.has(key)) continue;
          entries.push(candidate);
          entryKeys.add(key);
        }
        if (entries.length === existingEntries.length) {
          return;
        }
        await store.setState({
          threadId: entry.threadId,
          type: runtimeLedgerThreadStateType,
          value: { entries },
        });
      })
      .catch((error: unknown) => {
        this.persistFailure ??= { error };
        throw error;
      });
    void this.persistQueue.catch(() => undefined);
  }

  private hasLedgerEntry(entry: RuntimeLedgerEntry): boolean {
    const key = ledgerEntryKey(entry);
    return this.ledger.some((candidate) => ledgerEntryKey(candidate) === key);
  }

  private hasThreadMessage(
    options: RuntimeReadThreadRequest,
    message: RuntimeThreadMessage,
  ): boolean {
    return this.ledger.some(
      (entry) =>
        entry.type === "thread_message" &&
        matchesThread(entry, options) &&
        entry.message.id === message.id,
    );
  }
}

const runtimeLedgerThreadStateType = "pe.runtime.ledger.v1";

interface RuntimePersistedLedgerState {
  entries?: unknown[];
}

type ThreadSettingHarness = Harness<Record<string, unknown>> & {
  setThreadSetting?: (options: { key: string; value: unknown }) => Promise<void> | void;
};

type CloneThreadHarness = Harness<Record<string, unknown>> & {
  cloneThread?: (options: {
    sourceThreadId: string;
    resourceId?: string;
    title?: string;
  }) => Promise<{ id?: string; resourceId?: string }> | { id?: string; resourceId?: string };
};

function installRuntimeThreadSettings(
  requestContext: Parameters<typeof setRuntimeThreadSettings>[0],
  harness: Harness<Record<string, unknown>>,
): void {
  const setThreadSetting = (harness as ThreadSettingHarness).setThreadSetting?.bind(harness);
  if (!setThreadSetting) return;

  setRuntimeThreadSettings(requestContext, {
    setThreadSetting: (options) => setThreadSetting(options),
  });
}

async function collectSessionPromptFragments(
  contextProvider: RuntimeKernelContextProvider | undefined,
  threadId: string | undefined,
  formatFailure: ((error: unknown) => string) | undefined,
): Promise<string[]> {
  if (!contextProvider) return [];

  try {
    return [await contextProvider({ threadId })];
  } catch (error) {
    if (formatFailure) return [formatFailure(error)];
    const detail = escapeXml(error instanceof Error ? error.message : String(error));
    return [
      `<runtime-startup-context>\nContext seed unavailable: ${detail}.\n</runtime-startup-context>`,
    ];
  }
}

function isHarnessRunning(harness: Harness<Record<string, unknown>>): boolean {
  const target = harness as Harness<Record<string, unknown>> & {
    isRunning?: () => boolean;
  };
  return target.isRunning?.() ?? false;
}

type RuntimeHarnessFollowUp = (message: {
  content: string;
  requestContext: ReturnType<typeof createRuntimeRequestContext>;
}) => Promise<void>;

function requireFollowUp(harness: Harness<Record<string, unknown>>): RuntimeHarnessFollowUp {
  const target = harness as Harness<Record<string, unknown>> & {
    followUp?: RuntimeHarnessFollowUp;
  };
  if (!target.followUp) throw new Error("Runtime harness does not support follow-up messages.");
  return target.followUp.bind(target);
}

async function resolveHarnessMemory(harness: Harness<Record<string, unknown>>): Promise<{
  recall: (request: Record<string, unknown>) => Promise<{ messages?: unknown[] }>;
}> {
  const memoryHarness = harness as Harness<Record<string, unknown>> & {
    getResolvedMemory?: () => unknown;
  };
  const memory = await memoryHarness.getResolvedMemory?.();
  if (
    !memory ||
    typeof memory !== "object" ||
    typeof (memory as { recall?: unknown }).recall !== "function"
  ) {
    throw new Error("Runtime memory is not configured; cannot load thread history.");
  }
  return memory as unknown as {
    recall: (request: Record<string, unknown>) => Promise<{ messages?: unknown[] }>;
  };
}

function runtimeThreadMessage(message: unknown): RuntimeThreadMessage {
  const record = readRecord(message);
  const role = runtimeMessageRole(record.role, record.type);
  const type = typeof record.type === "string" ? record.type : undefined;
  const text = messageText(record.content);
  const createdAt = dateString(record.createdAt);
  return {
    id:
      typeof record.id === "string"
        ? record.id
        : stableRuntimeMessageId({ role, type, text, createdAt }),
    role,
    type,
    text,
    createdAt,
  };
}

function stableRuntimeMessageId(message: {
  role: RuntimeThreadMessage["role"];
  type?: string;
  text: string;
  createdAt?: string;
}): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify([message.role, message.type ?? "", message.createdAt ?? "", message.text]),
    )
    .digest("hex")
    .slice(0, 16);
  return `message:${hash}`;
}

function runtimeControlsFromState(state: unknown): RuntimeSessionControls {
  const record = readRecord(state);
  return {
    currentModelId: typeof record.currentModelId === "string" ? record.currentModelId : undefined,
    accessLevel: runtimeAccessLevel(record.accessLevel, record.yolo),
  };
}

function runtimeAccessLevel(value: unknown, yolo: unknown): RuntimeAccessLevel {
  if (value === "read-only" || value === "ask" || value === "trusted") return value;
  return yolo === true ? "trusted" : "ask";
}

function runtimeMessageRole(role: unknown, type: unknown): RuntimeThreadMessage["role"] {
  if (role === "assistant" || role === "system" || role === "tool") return role;
  if (role === "user") return "user";
  if (role === "signal" && type === "user") return "user";
  return "signal";
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  const record = readRecord(content);
  if (typeof record.content === "string") return record.content;
  const parts = Array.isArray(record.parts) ? record.parts : [];
  return parts.map(partText).filter(Boolean).join("\n");
}

function partText(part: unknown): string {
  const record = readRecord(part);
  if (typeof record.text === "string") return record.text;
  if (typeof record.reasoning === "string") return record.reasoning;
  return "";
}

function matchesThread(
  entry: RuntimeLedgerEntry,
  options: { threadId?: string; resourceId?: string },
): boolean {
  if (options.threadId && entry.threadId !== options.threadId) return false;
  if (options.resourceId && entry.resourceId !== options.resourceId) return false;
  return true;
}

function cloneKernelSession(session: RuntimeKernelSession): RuntimeKernelSession {
  return { ...session };
}

function cloneLedgerEntry(entry: RuntimeLedgerEntry): RuntimeLedgerEntry {
  return structuredClone(entry);
}

function threadKey(options: RuntimeReadThreadRequest): string {
  return `${options.resourceId ?? ""}:${options.threadId}`;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dateString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function persistedLedgerEntries(
  state: RuntimePersistedLedgerState | undefined,
): RuntimeLedgerEntry[] {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  return entries.filter(isRuntimeLedgerEntry);
}

function isPersistedLedgerEntry(
  entry: RuntimeLedgerEntry,
): entry is RuntimeLedgerEntry & { threadId: string } {
  return entry.type !== "thread_message" && typeof entry.threadId === "string";
}

function isRuntimeLedgerEntry(value: unknown): value is RuntimeLedgerEntry {
  const record = readRecord(value);
  return (
    typeof record.type === "string" &&
    typeof record.sequence === "number" &&
    Number.isFinite(record.sequence) &&
    typeof record.createdAt === "string"
  );
}

function ledgerEntryKey(entry: RuntimeLedgerEntry): string {
  return `${entry.type}:${entry.sequence}:${entry.createdAt}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
