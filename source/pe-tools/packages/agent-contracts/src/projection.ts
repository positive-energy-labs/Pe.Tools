import {
  type WorkbenchAgentCapabilities,
  type WorkbenchApprovalRequest,
  type WorkbenchCommandState,
  type WorkbenchInspectorEntry,
  type WorkbenchMessage,
  type WorkbenchRunStatus,
  type WorkbenchState,
  type WorkbenchThreadInfo,
  type WorkbenchToolCall,
} from "./contracts.ts";
import { deriveActivity, type Activity } from "./activity.ts";

export function defaultWorkbenchUiPreferences() {
  return {
    activePanel: "transcript",
    sidebarVisible: true,
    inspectorVisible: true,
    timestampsVisible: true,
    reasoningVisible: true,
    toolDetailsVisible: true,
    rawIoVisible: false,
    compactToolOutput: true,
    diffWrap: "word",
  } as const;
}

export function createWorkbenchState(): WorkbenchState {
  return {
    agent: {},
    threads: {
      items: [],
      status: "idle",
    },
    transcript: {
      messages: [],
      status: "idle",
    },
    tools: {
      calls: [],
      activeToolCallIds: [],
      recentToolCallIds: [],
      rawIoAvailable: false,
    },
    approvals: {
      requests: [],
    },
    plans: {
      entries: [],
    },
    models: {
      availableModels: [],
      recentModelIds: [],
    },
    modes: {
      availableModes: [],
    },
    access: {
      availableAccessLevels: [],
    },
    memory: {
      entries: [],
    },
    inspector: {
      contextEntries: [],
      rawMessages: [],
    },
    debug: {
      events: [],
    },
    sessionState: {
      values: {},
      hydrated: false,
    },
    uiPreferences: defaultWorkbenchUiPreferences(),
    uiStatus: {
      overall: { status: "idle" },
      start: commandState(),
      send: commandState(),
      threads: commandState(),
      loadThread: commandState(),
      cancel: commandState(),
      model: commandState(),
      mode: commandState(),
      errors: [],
    },
  };
}

export function selectVisibleThreads(state: WorkbenchState): WorkbenchThreadInfo[] {
  const session = state.agent.session;
  if (!session) return state.threads.items;

  const currentSessionThreads = state.threads.items.filter((thread) =>
    isCurrentSessionThread(thread, session.sessionId),
  );
  if (currentSessionThreads.length === 0) {
    return [threadFromSession(session), ...state.threads.items];
  }

  const preferred = preferredCurrentSessionThread(currentSessionThreads, session.sessionId);
  const visible: WorkbenchThreadInfo[] = [];
  let insertedCurrentSessionThread = false;
  for (const thread of state.threads.items) {
    if (!isCurrentSessionThread(thread, session.sessionId)) {
      visible.push(thread);
      continue;
    }

    if (!insertedCurrentSessionThread) {
      visible.push(preferred);
      insertedCurrentSessionThread = true;
    }
  }
  return visible;
}

export function selectActiveThreadId(state: WorkbenchState): string | undefined {
  const sessionId = state.agent.session?.sessionId;
  if (sessionId) {
    const currentSessionThreads = state.threads.items.filter((thread) =>
      isCurrentSessionThread(thread, sessionId),
    );
    const currentSessionThread = currentSessionThreads.length
      ? preferredCurrentSessionThread(currentSessionThreads, sessionId)
      : undefined;
    if (currentSessionThread) return currentSessionThread.threadId;
  }

  const activeThreadId = state.threads.activeThreadId;
  if (!activeThreadId) return sessionId;
  return (
    findThreadByThreadOrSessionId(state.threads.items, activeThreadId)?.threadId ?? activeThreadId
  );
}

export function selectActiveThread(state: WorkbenchState): WorkbenchThreadInfo | undefined {
  const activeThreadId = selectActiveThreadId(state);
  return activeThreadId
    ? selectVisibleThreads(state).find((thread) => thread.threadId === activeThreadId)
    : undefined;
}

export function selectVisibleTranscriptMessages(state: WorkbenchState): WorkbenchMessage[] {
  return state.transcript.messages;
}

export function selectPendingApprovals(state: WorkbenchState): WorkbenchApprovalRequest[] {
  return state.approvals.requests.filter((approval) => approval.status === "pending");
}

export function selectActiveToolCalls(state: WorkbenchState): WorkbenchToolCall[] {
  return state.tools.activeToolCallIds.flatMap((id) => {
    const toolCall = state.tools.calls.find((item) => item.id === id);
    return toolCall ? [toolCall] : [];
  });
}

export function selectRecentCompletedToolCalls(state: WorkbenchState): WorkbenchToolCall[] {
  return state.tools.recentToolCallIds.flatMap((id) => {
    const toolCall = state.tools.calls.find((item) => item.id === id);
    return toolCall ? [toolCall] : [];
  });
}

export function selectSelectedInspectorEntry(
  state: WorkbenchState,
): WorkbenchInspectorEntry | undefined {
  const selectedEntryId = state.inspector.selectedEntryId;
  if (!selectedEntryId) return undefined;
  return [...state.inspector.contextEntries, ...state.inspector.rawMessages].find(
    (entry) => entry.id === selectedEntryId,
  );
}

export function selectCurrentModelLabel(state: WorkbenchState): string | undefined {
  const currentModelId = state.models.currentModelId;
  if (!currentModelId) return undefined;
  const model = state.models.availableModels.find((item) => item.id === currentModelId);
  return model?.displayName ?? model?.id ?? currentModelId;
}

export function selectCurrentModeLabel(state: WorkbenchState): string | undefined {
  const currentModeId = state.modes.currentModeId;
  if (!currentModeId) return undefined;
  const mode = state.modes.availableModes.find((item) => item.id === currentModeId);
  return mode?.name ?? mode?.id ?? currentModeId;
}

export function selectOverallRunStatus(state: WorkbenchState): WorkbenchRunStatus {
  return state.uiStatus.overall.status;
}

/* ── Sentence snapshot — the chat sentence's testimony, minus route-doc facts.
   Trichotomy counts (awaiting-review) and the committed relax timer live with the
   route docs in the web layer; this selector only speaks WorkbenchState. ── */

export interface SentenceSnapshot {
  phase: "idle" | "thinking" | "working" | "asking";
  /** Present for working/asking. */
  activity?: Activity;
  /** Most recent finished tool call — the UI renders failures and relaxes on a timer. */
  lastCompleted?: { activity: Activity; isError: boolean; completedAt?: string };
}

export function selectSentenceSnapshot(state: WorkbenchState): SentenceSnapshot {
  const lastId = state.tools.recentToolCallIds[state.tools.recentToolCallIds.length - 1];
  const last = lastId ? state.tools.calls.find((call) => call.id === lastId) : undefined;
  const lastCompleted = last
    ? {
        activity: deriveActivity(last),
        isError: last.status === "failed",
        completedAt: last.completedAt,
      }
    : undefined;

  const asking = selectPendingApprovals(state)[0];
  if (asking) {
    const wanted = deriveActivity(asking.toolCall);
    return {
      phase: "asking",
      activity: { ...wanted, gerund: `asking to start ${wanted.gerund}` },
      lastCompleted,
    };
  }

  const running =
    state.uiStatus.overall.status === "running" || state.uiStatus.overall.status === "waiting";
  if (!running) return { phase: "idle", lastCompleted };

  const activeId = state.uiStatus.overall.activeToolCallId;
  const active =
    (activeId ? state.tools.calls.find((call) => call.id === activeId) : undefined) ??
    selectActiveToolCalls(state)[0];
  if (active) return { phase: "working", activity: deriveActivity(active), lastCompleted };

  // running with no live tool: thinking when the streaming tail is a reasoning part
  const tail = state.transcript.messages[state.transcript.messages.length - 1];
  const tailPart = tail?.status === "streaming" ? tail.parts[tail.parts.length - 1] : undefined;
  if (tailPart?.kind === "reasoning" || tailPart?.kind === "thought")
    return { phase: "thinking", lastCompleted };

  return { phase: "working", activity: { verb: "working", gerund: "working" }, lastCompleted };
}

export interface WorkbenchFeatureCard {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  hotkey?: string;
}

export interface WorkbenchCommandHint {
  id: string;
  command: string;
  description: string;
}

export interface WorkbenchChromeModel {
  title: string;
  subtitle: string;
  status: WorkbenchRunStatus;
  threadLabel: string;
  modelLabel: string;
  modeLabel: string;
  featureCards: WorkbenchFeatureCard[];
  commandHints: WorkbenchFeatureCard[];
  launchCommands: WorkbenchCommandHint[];
}

export function selectWorkbenchChrome(state: WorkbenchState): WorkbenchChromeModel {
  const capabilities = state.agent.info?.capabilities ?? {};
  const featureCards = workbenchFeatureCards(capabilities);
  return {
    title: state.agent.info?.runtime?.title ?? state.agent.info?.title ?? "Pea",
    subtitle:
      state.agent.info?.runtime?.description ??
      "agent workbench over shared runtime state, transport, and projection seams",
    status: selectOverallRunStatus(state),
    threadLabel: selectActiveThread(state)?.title ?? state.threads.activeThreadId ?? "new session",
    modelLabel: selectCurrentModelLabel(state) ?? "model: default",
    modeLabel: selectCurrentModeLabel(state) ?? "mode: default",
    featureCards,
    commandHints: featureCards.filter((card) => card.enabled),
    launchCommands: workbenchLaunchCommands(),
  };
}

function workbenchLaunchCommands(): WorkbenchCommandHint[] {
  return [
    {
      id: "agent",
      command: "pea agent",
      description: "Open the Pea operator workbench in the current repo.",
    },
  ];
}

function workbenchFeatureCards(capabilities: WorkbenchAgentCapabilities): WorkbenchFeatureCard[] {
  return [
    {
      id: "threads",
      title: "Thread timeline",
      description: "List, quick-switch, and reload conversation history.",
      enabled: Boolean(capabilities.threads || capabilities.history),
      hotkey: "ctrl+r",
    },
    {
      id: "tools",
      title: "Tool trace",
      description: "Expose active tools, locations, raw IO, and debug breadcrumbs.",
      enabled: Boolean(capabilities.toolCalls),
      hotkey: "right pane",
    },
    {
      id: "approvals",
      title: "Permission flow",
      description: "Resolve tool approvals without hiding the transcript.",
      enabled: Boolean(capabilities.approvals),
      hotkey: "y/a/n",
    },
    {
      id: "models",
      title: "Model and mode control",
      description: "Surface model switching and Pea session modes through shared commands.",
      enabled: Boolean(capabilities.modelSwitching || capabilities.sessionModes),
      hotkey: "palette",
    },
    {
      id: "inspector",
      title: "Inspector",
      description: "Show system prompt, context, raw events, and observational memory.",
      enabled: Boolean(capabilities.systemPromptInspection || capabilities.observationalMemory),
      hotkey: "debug",
    },
  ];
}
function commandState(): WorkbenchCommandState {
  return { status: "idle" };
}

function threadFromSession(
  session: NonNullable<WorkbenchState["agent"]["session"]>,
): WorkbenchThreadInfo {
  return {
    threadId: session.sessionId,
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    metadata: session.metadata,
  };
}

function isCurrentSessionThread(thread: WorkbenchThreadInfo, sessionId: string): boolean {
  return thread.threadId === sessionId || thread.sessionId === sessionId;
}

function preferredCurrentSessionThread(
  threads: WorkbenchThreadInfo[],
  sessionId: string,
): WorkbenchThreadInfo {
  return (
    threads.find((thread) => thread.sessionId === sessionId && thread.threadId !== sessionId) ??
    threads.find((thread) => thread.sessionId === sessionId) ??
    threads[0]!
  );
}

function findThreadByThreadOrSessionId(
  threads: WorkbenchThreadInfo[],
  id: string,
): WorkbenchThreadInfo | undefined {
  return threads.find((thread) => thread.threadId === id || thread.sessionId === id);
}
