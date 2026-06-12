import type {
  PeWorkbenchUpdateMetadata,
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
  WorkbenchMessage,
  WorkbenchModelInfo,
  WorkbenchModelState,
  WorkbenchNewSessionRequest,
  WorkbenchObservationMemoryEntry,
  WorkbenchPlanEntry,
  WorkbenchPromptResult,
  WorkbenchRunState,
  WorkbenchSessionInfo,
  WorkbenchSessionModeInfo,
  WorkbenchSessionModeState,
  WorkbenchSetModeRequest,
  WorkbenchSetModelRequest,
  WorkbenchStartRequest,
  WorkbenchStartResponse,
  WorkbenchState,
  WorkbenchThreadInfo,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import { applyWorkbenchEvent, createWorkbenchState } from "@pe/agent-projection";

export type WorkbenchStateHandler = (state: WorkbenchState, event: WorkbenchEvent) => void;

export interface WorkbenchControllerOptions extends WorkbenchStartRequest {}

export class WorkbenchController {
  private state = createWorkbenchState();
  private readonly handlers = new Set<WorkbenchStateHandler>();
  private readonly unsubscribeClient: () => void;
  private startPromise: Promise<WorkbenchStartResponse> | null = null;

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
      const threads = await this.client.listThreads?.(this.options.cwd);
      if (threads)
        this.apply({ type: "threads_replaced", threads, activeThreadId: session.sessionId });
      return { agent, session, threads };
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

  async send(text: string): Promise<WorkbenchPromptResult | undefined> {
    const prompt = text.trim();
    if (!prompt) return undefined;

    await this.start();
    const session = this.state.agent.session;
    if (!session) throw new Error("Workbench session was not created.");

    return this.runCommand("send", async () => {
      this.apply({
        type: "message_part_delta",
        messageId: `local-user:${Date.now()}`,
        role: "user",
        part: { kind: "text", text: `${prompt}\n` },
        status: "complete",
        provenance: { source: "workbench", protocol: "local", sessionId: session.sessionId },
      });
      this.apply({ type: "run_status_changed", status: "running" });
      const result = await this.client.sendPrompt({ sessionId: session.sessionId, text: prompt });
      this.apply({ type: "run_status_changed", status: "idle", stopReason: result.stopReason });
      if (this.client.listThreads) await this.refreshThreads();
      return result;
    });
  }

  async refreshThreads(): Promise<WorkbenchThreadInfo[]> {
    await this.ensureInitialized();
    return this.runCommand("threads", async () => {
      const threads = await this.client.listThreads?.(this.options.cwd);
      if (threads)
        this.apply({
          type: "threads_replaced",
          threads,
          activeThreadId: this.state.threads.activeThreadId,
        });
      return threads ?? this.state.threads.items;
    });
  }

  async loadThread(threadId: string): Promise<WorkbenchSessionInfo | undefined> {
    await this.ensureInitialized();
    const loadThread = this.client.loadThread?.bind(this.client);
    if (!loadThread) return undefined;

    return this.runCommand("loadThread", async () => {
      this.apply({ type: "thread_selected", threadId });
      const beforeMessages = this.state.transcript.messages;
      const session = await loadThread({ ...this.sessionRequest(), threadId });
      const replayedMessages = this.state.transcript.messages;
      this.apply({
        type: "session_started",
        session,
        thread: { threadId, sessionId: session.sessionId, title: session.title },
      });
      if (replayedMessages !== beforeMessages) {
        this.apply({ type: "transcript_replaced", messages: replayedMessages });
      }
      await this.refreshThreads();
      return session;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type {
  PeWorkbenchUpdateMetadata,
  WorkbenchAgentClient,
  WorkbenchAgentInfo,
  WorkbenchApprovalOption,
  WorkbenchApprovalRequest,
  WorkbenchDebugEvent,
  WorkbenchEvent,
  WorkbenchInspectorEntry,
  WorkbenchInspectorState,
  WorkbenchLoadThreadRequest,
  WorkbenchMessage,
  WorkbenchModelInfo,
  WorkbenchModelState,
  WorkbenchObservationMemoryEntry,
  WorkbenchPlanEntry,
  WorkbenchRunState,
  WorkbenchSessionInfo,
  WorkbenchSessionModeInfo,
  WorkbenchSessionModeState,
  WorkbenchState,
  WorkbenchThreadInfo,
  WorkbenchToolCall,
};
