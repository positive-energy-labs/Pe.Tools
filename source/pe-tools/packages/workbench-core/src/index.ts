import type {
  PeWorkbenchUpdateMetadata,
  WorkbenchAccessLevelState,
  WorkbenchAgentClient,
  WorkbenchAgentInfo,
  WorkbenchApprovalOption,
  WorkbenchApprovalRequest,
  WorkbenchCancelRequest,
  WorkbenchDebugEvent,
  WorkbenchEvent,
  WorkbenchInspectorEntry,
  WorkbenchInspectorState,
  WorkbenchLoadThreadRequest,
  WorkbenchLoadThreadResponse,
  WorkbenchMessage,
  WorkbenchMessagePart,
  WorkbenchModelInfo,
  WorkbenchModelState,
  WorkbenchNewSessionRequest,
  WorkbenchObservationMemoryEntry,
  WorkbenchPlanEntry,
  WorkbenchPromptResult,
  WorkbenchQueueMessageResult,
  WorkbenchRawThreadSnapshot,
  WorkbenchRunState,
  WorkbenchSetAccessLevelRequest,
  WorkbenchSessionInfo,
  WorkbenchSessionModeInfo,
  WorkbenchSessionModeState,
  WorkbenchSetModeRequest,
  WorkbenchSetModelRequest,
  WorkbenchStartRequest,
  WorkbenchUiPreferencesState,
  WorkbenchStartResponse,
  WorkbenchState,
  WorkbenchThreadInfo,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import {
  applyWorkbenchEvent,
  createWorkbenchState,
  selectActiveThreadId,
  selectVisibleThreads,
} from "@pe/agent-contracts";

export type WorkbenchStateHandler = (state: WorkbenchState, event: WorkbenchEvent) => void;

export interface WorkbenchControllerOptions extends WorkbenchStartRequest {
  loadInitialThreads?: boolean;
}

export class WorkbenchController {
  private state = createWorkbenchState();
  private readonly handlers = new Set<WorkbenchStateHandler>();
  private readonly unsubscribeClient: () => void;
  private startPromise: Promise<WorkbenchStartResponse> | null = null;
  private localMessageSequence = 0;
  private activeLocalUserMessageId: string | undefined;

  constructor(
    private readonly client: WorkbenchAgentClient,
    private readonly options: WorkbenchControllerOptions,
  ) {
    this.unsubscribeClient = client.subscribe((event) => this.apply(event));
  }

  getState(): WorkbenchState {
    return this.state;
  }

  subscribe(handler: WorkbenchStateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<WorkbenchStartResponse> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.runCommand("start", async () => {
      const agent = await this.client.initialize();
      this.apply({ type: "agent_initialized", agent });
      const session = await this.client.newSession(this.sessionRequest());
      this.apply({ type: "session_started", session });
      if (this.options.loadInitialThreads !== false) {
        const initialThreads = this.loadInitialThreadState(session.sessionId);
        await ignoreSlow(initialThreads, 1500);
        void initialThreads.catch(() => undefined);
      }
      return {
        agent,
        session: this.state.agent.session ?? session,
        threads: this.state.threads.items,
      };
    });
    return this.startPromise;
  }

  async newSession(
    request: Partial<WorkbenchNewSessionRequest> = {},
  ): Promise<WorkbenchSessionInfo> {
    await this.ensureInitialized();
    return this.runCommand("start", async () => {
      const session = await this.client.newSession({ ...this.sessionRequest(), ...request });
      this.apply({ type: "session_started", session });
      await this.refreshThreads();
      return session;
    });
  }

  async send(text: string): Promise<WorkbenchQueueMessageResult | undefined> {
    return this.sendWithDelivery(text, "queued");
  }

  async sendImmediate(text: string): Promise<WorkbenchPromptResult | undefined> {
    return this.sendWithDelivery(text, "immediate");
  }

  private async sendWithDelivery(
    text: string,
    delivery: "queued",
  ): Promise<WorkbenchQueueMessageResult | undefined>;
  private async sendWithDelivery(
    text: string,
    delivery: "immediate",
  ): Promise<WorkbenchPromptResult | undefined>;
  private async sendWithDelivery(
    text: string,
    delivery: "queued" | "immediate",
  ): Promise<WorkbenchQueueMessageResult | WorkbenchPromptResult | undefined> {
    const prompt = text.trim();
    if (!prompt) return undefined;

    await this.start();
    const session = this.state.agent.session;
    if (!session) throw new Error("Workbench session was not created.");

    return this.runCommand("send", async () => {
      const alreadyRunning = this.state.uiStatus.overall.status === "running";
      const messageId = alreadyRunning
        ? (this.activeLocalUserMessageId ??= this.nextLocalUserMessageId())
        : this.nextLocalUserMessageId();
      this.activeLocalUserMessageId = messageId;
      this.apply({
        type: "message_part_delta",
        messageId,
        role: "user",
        part: { kind: "text", text: `${prompt}\n` },
        status: "complete",
        provenance: { source: "workbench", protocol: "local", sessionId: session.sessionId },
      });

      if (!alreadyRunning) this.apply({ type: "run_status_changed", status: "running" });

      if (delivery === "queued" && this.client.queueMessage) {
        const result = await this.client.queueMessage({
          sessionId: session.sessionId,
          text: prompt,
        });
        if (!result.queued) {
          this.apply({ type: "run_status_changed", status: "idle", stopReason: result.stopReason });
          this.activeLocalUserMessageId = undefined;
        }
        if (this.client.listThreads) await this.refreshThreads();
        return result;
      }

      const result = await this.client.sendPrompt({ sessionId: session.sessionId, text: prompt });
      this.apply({ type: "run_status_changed", status: "idle", stopReason: result.stopReason });
      this.activeLocalUserMessageId = undefined;
      if (this.client.listThreads) await this.refreshThreads();
      return result;
    });
  }

  async refreshThreads(): Promise<WorkbenchThreadInfo[]> {
    await this.ensureInitialized();
    return this.runCommand("threads", async () => {
      const threads = await this.client.listThreads?.(this.options.cwd);
      const projectedState = stateWithThreadItems(this.state, threads);
      const visibleThreads = threads ? selectVisibleThreads(projectedState) : undefined;
      const activeThreadId = threads ? selectActiveThreadId(projectedState) : undefined;
      if (visibleThreads)
        this.apply({
          type: "threads_replaced",
          threads: visibleThreads,
          activeThreadId,
        });
      return visibleThreads ?? this.state.threads.items;
    });
  }

  async loadThread(threadId: string): Promise<WorkbenchSessionInfo | undefined> {
    await this.ensureInitialized();
    const loadThread = this.client.loadThread?.bind(this.client);
    if (!loadThread) return undefined;

    return this.runCommand("loadThread", async () => {
      const session = await this.loadThreadSnapshot(threadId);
      await this.refreshThreads();
      return session;
    });
  }

  async rawThread(
    threadId = selectActiveThreadId(this.state),
  ): Promise<WorkbenchRawThreadSnapshot> {
    await this.ensureInitialized();
    if (!threadId) throw new Error("No thread is selected.");
    const rawThread = this.client.rawThread?.bind(this.client);
    if (!rawThread) throw new Error("Workbench client does not support raw thread snapshots.");
    const thread = findThreadForLoad(this.state.threads.items, threadId);
    return rawThread({
      ...this.sessionRequest(),
      threadId: thread?.threadId ?? threadId,
      ...(thread?.sessionId ? { sessionId: thread.sessionId } : {}),
    });
  }

  resolveApproval(requestId: string, optionId?: string): void {
    this.client.resolveApproval?.(requestId, optionId);
    this.apply({
      type: "approval_resolved",
      requestId,
      resolution: { optionId, resolvedAt: new Date().toISOString() },
    });
  }

  async cancel(request?: Partial<WorkbenchCancelRequest>): Promise<void> {
    const sessionId = request?.sessionId ?? this.state.agent.session?.sessionId;
    if (!sessionId) return;
    await this.runCommand("cancel", async () => {
      this.apply({ type: "run_status_changed", status: "canceling" });
      await this.client.cancel?.(sessionId);
      this.apply({ type: "run_status_changed", status: "idle" });
    });
  }

  async setModel(request: WorkbenchSetModelRequest): Promise<void> {
    await this.runCommand("model", async () => {
      await this.client.setModel?.(request.modelId);
      this.apply({
        type: "model_state_updated",
        model: {
          currentModelId: request.modelId,
          recentModelIds: recentIds(request.modelId, this.state.models.recentModelIds),
        },
      });
    });
  }

  async setMode(request: WorkbenchSetModeRequest): Promise<void> {
    await this.runCommand("mode", async () => {
      await this.client.setMode?.(request.modeId);
      this.apply({ type: "session_mode_updated", sessionMode: { currentModeId: request.modeId } });
    });
  }

  async setAccessLevel(request: WorkbenchSetAccessLevelRequest): Promise<void> {
    await this.runCommand("model", async () => {
      await this.client.setAccessLevel?.(request.accessLevel);
      this.apply({
        type: "access_level_updated",
        access: { currentAccessLevel: request.accessLevel },
      });
    });
  }

  updateUiPreferences(preferences: Partial<WorkbenchUiPreferencesState>): void {
    this.apply({ type: "ui_preferences_updated", preferences });
  }

  toggleUiPreference(preference: keyof WorkbenchUiPreferencesState): void {
    const value = this.state.uiPreferences[preference];
    if (typeof value !== "boolean") return;
    this.updateUiPreferences({ [preference]: !value });
  }

  async refreshInspector(): Promise<void> {
    await this.client.refreshInspector?.();
  }

  async close(): Promise<void> {
    this.unsubscribeClient();
    await this.client.close?.();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.state.agent.info) return;
    const agent = await this.client.initialize();
    this.apply({ type: "agent_initialized", agent });
  }

  private sessionRequest(): WorkbenchNewSessionRequest {
    return {
      cwd: this.options.cwd,
      additionalDirectories: this.options.additionalDirectories,
    };
  }

  private async loadThreadSnapshot(threadId: string): Promise<WorkbenchSessionInfo | undefined> {
    const loadThread = this.client.loadThread?.bind(this.client);
    if (!loadThread) return undefined;

    const thread = findThreadForLoad(this.state.threads.items, threadId);
    const selectedThreadId = thread?.threadId ?? threadId;
    if (thread?.lock?.status === "locked") {
      throw new Error(
        `Thread ${selectedThreadId} is locked${thread.lock.ownerPid ? ` by PID ${thread.lock.ownerPid}` : ""}.`,
      );
    }
    this.apply({ type: "thread_selected", threadId: selectedThreadId });
    const beforeMessages = this.state.transcript.messages;
    const response = await loadThread({
      ...this.sessionRequest(),
      threadId: selectedThreadId,
      ...(thread?.sessionId ? { sessionId: thread.sessionId } : {}),
    });
    const { session, messages, events } = normalizeLoadThreadResponse(response);
    const replayedMessages = this.state.transcript.messages;
    this.apply({
      type: "session_started",
      session,
      thread: { threadId: selectedThreadId, sessionId: session.sessionId, title: session.title },
    });
    if (messages) {
      this.apply({ type: "transcript_replaced", messages });
    } else if (replayedMessages !== beforeMessages) {
      this.apply({ type: "transcript_replaced", messages: replayedMessages });
    }
    for (const event of events ?? []) this.apply(event);
    return session;
  }

  private async loadInitialThreadState(sessionId: string): Promise<void> {
    try {
      const threads = await this.client.listThreads?.(this.options.cwd);
      const projectedState = stateWithThreadItems(this.state, threads);
      const visibleThreads = threads ? selectVisibleThreads(projectedState) : undefined;
      const activeThreadId = threads ? selectActiveThreadId(projectedState) : undefined;
      if (visibleThreads) {
        this.apply({
          type: "threads_replaced",
          threads: visibleThreads,
          activeThreadId,
        });
      }
      await this.loadThreadSnapshot(sessionId);
    } catch (error: unknown) {
      this.apply({
        type: "error",
        command: "threads",
        message: `Initial thread refresh failed: ${errorMessage(error)}`,
      });
    }
  }

  private async runCommand<T>(
    command: Exclude<keyof WorkbenchState["uiStatus"], "overall" | "errors">,
    action: () => Promise<T>,
  ): Promise<T> {
    this.apply({
      type: "ui_status_changed",
      command,
      status: "running",
      timestamp: new Date().toISOString(),
    });
    try {
      const result = await action();
      this.apply({
        type: "ui_status_changed",
        command,
        status: "succeeded",
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.apply({ type: "error", command, message });
      throw error;
    }
  }

  private apply(event: WorkbenchEvent): void {
    this.state = applyWorkbenchEvent(this.state, event);
    for (const handler of this.handlers) handler(this.state, event);
  }

  private nextLocalUserMessageId(): string {
    this.localMessageSequence += 1;
    return `local-user:${this.localMessageSequence}`;
  }
}

export function createWorkbenchController(
  client: WorkbenchAgentClient,
  options: WorkbenchControllerOptions,
): WorkbenchController {
  return new WorkbenchController(client, options);
}

function recentIds(id: string, existing: string[]): string[] {
  return [id, ...existing.filter((item) => item !== id)].slice(0, 16);
}

function stateWithThreadItems(
  state: WorkbenchState,
  threads: WorkbenchThreadInfo[] | undefined,
): WorkbenchState {
  return threads ? { ...state, threads: { ...state.threads, items: threads } } : state;
}

function findThreadForLoad(
  threads: WorkbenchThreadInfo[],
  threadId: string,
): WorkbenchThreadInfo | undefined {
  return (
    threads.find((thread) => thread.threadId === threadId) ??
    threads.find((thread) => thread.sessionId === threadId)
  );
}

function normalizeLoadThreadResponse(
  response: WorkbenchSessionInfo | WorkbenchLoadThreadResponse,
): WorkbenchLoadThreadResponse {
  return "session" in response ? response : { session: response };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ignoreSlow(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type {
  PeWorkbenchUpdateMetadata,
  WorkbenchAgentClient,
  WorkbenchAccessLevelState,
  WorkbenchAgentInfo,
  WorkbenchApprovalOption,
  WorkbenchApprovalRequest,
  WorkbenchDebugEvent,
  WorkbenchEvent,
  WorkbenchInspectorEntry,
  WorkbenchInspectorState,
  WorkbenchLoadThreadRequest,
  WorkbenchMessage,
  WorkbenchMessagePart,
  WorkbenchModelInfo,
  WorkbenchModelState,
  WorkbenchObservationMemoryEntry,
  WorkbenchPlanEntry,
  WorkbenchQueueMessageResult,
  WorkbenchRawThreadSnapshot,
  WorkbenchRunState,
  WorkbenchSessionInfo,
  WorkbenchSessionModeInfo,
  WorkbenchSessionModeState,
  WorkbenchState,
  WorkbenchThreadInfo,
  WorkbenchToolCall,
  WorkbenchUiPreferencesState,
};
