import type { ContentBlock, SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import {
  peWorkbenchUpdateMetadataKey,
  type PeWorkbenchUpdateMetadata,
  type WorkbenchAccessLevelInfo,
  type WorkbenchAccessLevelState,
  type WorkbenchAgentCapabilities,
  type WorkbenchApprovalRequest,
  type WorkbenchCommandState,
  type WorkbenchCommandStatus,
  type WorkbenchDebugEvent,
  type WorkbenchEvent,
  type WorkbenchInspectorEntry,
  type WorkbenchJsonObject,
  type WorkbenchMessage,
  type WorkbenchMessagePart,
  type WorkbenchModelInfo,
  type WorkbenchModelState,
  type WorkbenchObservationMemoryEntry,
  type WorkbenchPlanEntry,
  type WorkbenchRole,
  type WorkbenchRunState,
  type WorkbenchRunStatus,
  type WorkbenchSessionModeInfo,
  type WorkbenchSessionModeState,
  type WorkbenchState,
  type WorkbenchSystemPromptSnapshot,
  type WorkbenchThreadInfo,
  type WorkbenchToolCall,
  type WorkbenchToolLocation,
  type WorkbenchToolTimelineEntry,
} from "@pe/agent-contracts";
import { z } from "zod";

const maxDebugEvents = 500;
const maxRecentToolCalls = 128;
const maxObservationMemoryEntries = 128;

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

export function applyWorkbenchEvent(state: WorkbenchState, event: WorkbenchEvent): WorkbenchState {
  switch (event.type) {
    case "agent_initialized":
      return { ...state, agent: { ...state.agent, info: event.agent } };
    case "session_started": {
      const thread = event.thread ?? threadFromSession(event.session);
      return {
        ...state,
        agent: { ...state.agent, session: event.session },
        threads: {
          ...state.threads,
          items: upsertThread(state.threads.items, thread),
          activeThreadId: thread.threadId,
          selectedThreadId: thread.threadId,
          status: "loaded",
          error: undefined,
        },
        transcript: { messages: [], status: "loaded" },
        tools: { calls: [], activeToolCallIds: [], recentToolCallIds: [], rawIoAvailable: false },
        approvals: { requests: [] },
        plans: { entries: [] },
        uiStatus: {
          ...state.uiStatus,
          overall: { status: "idle" },
          start: completeCommand(state.uiStatus.start, "succeeded"),
          loadThread: completeCommand(state.uiStatus.loadThread, "succeeded"),
        },
      };
    }
    case "session_updated": {
      const session = mergeSession(state.agent.session, event.session);
      return {
        ...state,
        agent: {
          ...state.agent,
          session,
        },
        threads: session
          ? {
              ...state.threads,
              items: upsertThread(state.threads.items, threadFromSession(session)),
            }
          : state.threads,
      };
    }
    case "ui_status_changed":
      return updateUiCommandStatus(
        state,
        event.command,
        event.status,
        event.error,
        event.timestamp,
      );
    case "run_status_changed":
      return {
        ...state,
        uiStatus: {
          ...state.uiStatus,
          overall: updateRunStatus(state.uiStatus.overall, event),
        },
      };
    case "transcript_replaced":
      return {
        ...state,
        transcript: { messages: event.messages, status: "loaded" },
        inspector: mergeInspector(state.inspector, {
          rawMessages: rawMessageEntries(event.messages),
        }),
      };
    case "message_part_delta": {
      const messages = upsertMessagePart(state.transcript.messages, event);
      return {
        ...state,
        transcript: {
          ...state.transcript,
          status: "loaded",
          messages,
        },
        inspector: mergeInspector(state.inspector, {
          rawMessages: rawMessageEntries(messages),
        }),
      };
    }
    case "message_updated": {
      const messages = upsertMessage(state.transcript.messages, event.message);
      return {
        ...state,
        transcript: {
          ...state.transcript,
          messages,
        },
        inspector: mergeInspector(state.inspector, {
          rawMessages: rawMessageEntries(messages),
        }),
      };
    }
    case "tool_call_updated": {
      const calls = upsertToolCall(state.tools.calls, event.toolCall);
      return {
        ...state,
        tools: {
          calls,
          activeToolCallIds: activeToolCallIds(calls),
          recentToolCallIds: recentToolCallIds(calls),
          rawIoAvailable: calls.some(
            (toolCall) => toolCall.rawInput !== undefined || toolCall.rawOutput !== undefined,
          ),
        },
        uiStatus: {
          ...state.uiStatus,
          overall: updateActiveToolCall(state.uiStatus.overall, event.toolCall),
        },
      };
    }
    case "plan_replaced":
      return { ...state, plans: { entries: event.entries } };
    case "approval_requested":
      return {
        ...state,
        approvals: { requests: upsertApproval(state.approvals.requests, event.approval) },
        uiStatus: {
          ...state.uiStatus,
          overall: { ...state.uiStatus.overall, status: "waiting" },
        },
      };
    case "approval_resolved":
      return {
        ...state,
        approvals: {
          requests: state.approvals.requests.map((approval) =>
            approval.requestId === event.requestId
              ? {
                  ...approval,
                  status: "resolved",
                  resolvedAt: event.resolution?.resolvedAt,
                  resolution: event.resolution,
                }
              : approval,
          ),
        },
        uiStatus: {
          ...state.uiStatus,
          overall: {
            ...state.uiStatus.overall,
            status:
              state.uiStatus.overall.status === "waiting"
                ? "running"
                : state.uiStatus.overall.status,
          },
        },
      };
    case "approvals_cleared":
      return {
        ...state,
        approvals: {
          requests: state.approvals.requests.map((approval) =>
            approval.status === "pending" ? { ...approval, status: "canceled" } : approval,
          ),
        },
      };
    case "threads_replaced":
      return {
        ...state,
        threads: {
          ...state.threads,
          items: event.threads,
          activeThreadId: event.activeThreadId ?? state.threads.activeThreadId,
          selectedThreadId: event.activeThreadId ?? state.threads.selectedThreadId,
          status: event.status ?? "loaded",
          error: undefined,
        },
      };
    case "thread_selected":
      return {
        ...state,
        threads: { ...state.threads, selectedThreadId: event.threadId },
      };
    case "observational_memory_updated":
      return {
        ...state,
        memory: {
          entries: capEnd(
            upsertObservationMemory(state.memory.entries, event.entry),
            maxObservationMemoryEntries,
          ),
        },
      };
    case "observational_memory_removed":
      return {
        ...state,
        memory: {
          entries: state.memory.entries.filter((entry) => entry.id !== event.id),
        },
      };
    case "inspector_updated":
      return { ...state, inspector: mergeInspector(state.inspector, event.inspector) };
    case "model_state_updated":
      return { ...state, models: mergeModel(state.models, event.model) };
    case "session_mode_updated":
      return { ...state, modes: mergeSessionMode(state.modes, event.sessionMode) };
    case "access_level_updated":
      return { ...state, access: mergeAccessLevel(state.access, event.access) };
    case "ui_preferences_updated":
      return { ...state, uiPreferences: { ...state.uiPreferences, ...event.preferences } };
    case "debug_event_recorded":
      return {
        ...state,
        debug: {
          ...state.debug,
          events: capEnd(
            [...state.debug.events, timestampDebugEvent(event.debugEvent)],
            maxDebugEvents,
          ),
        },
      };
    case "error":
      return {
        ...updateUiCommandStatus(state, event.command, "failed", event.message),
        uiStatus: {
          ...updateUiCommandStatus(state, event.command, "failed", event.message).uiStatus,
          overall: { ...state.uiStatus.overall, status: "error" },
          errors: [...state.uiStatus.errors, event.message],
        },
      };
    default:
      return state;
  }
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
    {
      id: "web",
      command: "pea web",
      description: "Serve the browser workbench over the shared runtime transport.",
    },
    {
      id: "peco",
      command: "peco",
      description: "Use the developer coding workbench for Pe.Tools repo tasks.",
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

export function acpSessionUpdateToWorkbenchEvents(
  sessionId: string,
  update: unknown,
): WorkbenchEvent[] {
  const sessionUpdate = readAcpSessionUpdate(update);
  return [
    acpDebugEvent(sessionId, update),
    ...(sessionUpdate ? acpCoreEvents(sessionId, sessionUpdate) : []),
    ...(sessionUpdate ? acpMetadataEvents(sessionUpdate) : []),
  ];
}

function acpCoreEvents(sessionId: string, update: SessionUpdate): WorkbenchEvent[] {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      return messagePartDelta(sessionId, update.messageId ?? `${sessionId}:user`, "user", {
        kind: "text",
        text: contentBlockText(update.content),
      });
    case "agent_message_chunk":
      return messagePartDelta(
        sessionId,
        update.messageId ?? `${sessionId}:assistant`,
        "assistant",
        {
          kind: "text",
          text: contentBlockText(update.content),
        },
      );
    case "agent_thought_chunk":
      return messagePartDelta(sessionId, update.messageId ?? `${sessionId}:thought`, "thought", {
        kind: "thought",
        text: contentBlockText(update.content),
      });
    case "tool_call": {
      const toolCall = toolCallFromUpdate(sessionId, update);
      return [{ type: "tool_call_updated", toolCall }, ...toolReferenceEvents(sessionId, toolCall)];
    }
    case "tool_call_update":
      return [{ type: "tool_call_updated", toolCall: toolCallFromUpdate(sessionId, update) }];
    case "plan":
      return [{ type: "plan_replaced", entries: update.entries.map(planEntry) }];
    case "plan_update":
      return planUpdateEvents(update.plan);
    case "plan_removed":
      return [{ type: "plan_replaced", entries: [] }];
    case "current_mode_update":
      return [
        { type: "session_mode_updated", sessionMode: { currentModeId: update.currentModeId } },
      ];
    case "session_info_update":
      return [
        {
          type: "session_updated",
          session: {
            title: update.title ?? undefined,
            updatedAt: update.updatedAt ?? undefined,
            metadata: recordMetadata(update._meta),
          },
        },
      ];
    case "available_commands_update":
    case "config_option_update":
    case "usage_update":
      return [];
    default:
      return [];
  }
}

function commandState(): WorkbenchCommandState {
  return { status: "idle" };
}

function updateUiCommandStatus(
  state: WorkbenchState,
  command: keyof Omit<WorkbenchState["uiStatus"], "overall" | "errors"> | undefined,
  status: WorkbenchCommandStatus,
  error?: string,
  timestamp?: string,
): WorkbenchState {
  if (!command) return state;
  const current = state.uiStatus[command];
  const next =
    status === "running"
      ? { status, startedAt: timestamp, error: undefined }
      : { ...current, status, completedAt: timestamp, error };
  return {
    ...state,
    uiStatus: {
      ...state.uiStatus,
      [command]: next,
    },
  };
}

function completeCommand(
  command: WorkbenchCommandState,
  status: Exclude<WorkbenchCommandStatus, "running">,
): WorkbenchCommandState {
  return command.status === "running" ? { ...command, status } : command;
}

function updateRunStatus(
  run: WorkbenchRunState,
  event: Extract<WorkbenchEvent, { type: "run_status_changed" }>,
): WorkbenchRunState {
  const next = {
    ...run,
    status: event.status,
    stopReason: event.stopReason ?? run.stopReason,
    activeToolCallId: event.activeToolCallId ?? run.activeToolCallId,
  };
  if ((event.status === "running" || event.status === "starting") && run.status !== event.status) {
    return { ...next, startedAt: event.timestamp };
  }
  if (event.status === "idle" && run.status !== "idle")
    return { ...next, completedAt: event.timestamp };
  return next;
}

function upsertMessagePart(
  messages: WorkbenchMessage[],
  update: Extract<WorkbenchEvent, { type: "message_part_delta" }>,
): WorkbenchMessage[] {
  const now = update.timestamp;
  const index = messages.findIndex((message) => message.id === update.messageId);
  if (index < 0) {
    return [
      ...messages,
      {
        id: update.messageId,
        role: update.role,
        parts: [withProvenance(update.part, update.provenance)],
        status: update.status ?? "streaming",
        createdAt: now,
        updatedAt: now,
        provenance: update.provenance,
      },
    ];
  }

  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          role: update.role,
          parts: appendMessagePart(message.parts, withProvenance(update.part, update.provenance)),
          status: update.status ?? message.status,
          updatedAt: now,
          provenance: update.provenance ?? message.provenance,
        }
      : message,
  );
}

function appendMessagePart(
  parts: WorkbenchMessagePart[],
  part: WorkbenchMessagePart,
): WorkbenchMessagePart[] {
  const last = parts.at(-1);
  if (last && isTextualPart(last) && isTextualPart(part) && last.kind === part.kind) {
    return [...parts.slice(0, -1), { ...last, text: `${last.text}${part.text}` }];
  }
  return [...parts, part];
}

function withProvenance(
  part: WorkbenchMessagePart,
  provenance: Extract<WorkbenchEvent, { type: "message_part_delta" }>["provenance"],
): WorkbenchMessagePart {
  return provenance && !part.provenance ? { ...part, provenance } : part;
}

function isTextualPart(
  part: WorkbenchMessagePart,
): part is Extract<WorkbenchMessagePart, { kind: "text" | "reasoning" | "thought" }> {
  return part.kind === "text" || part.kind === "reasoning" || part.kind === "thought";
}

function upsertMessage(messages: WorkbenchMessage[], update: WorkbenchMessage): WorkbenchMessage[] {
  const index = messages.findIndex((message) => message.id === update.id);
  if (index < 0) return [...messages, update];
  return messages.map((message, messageIndex) => (messageIndex === index ? update : message));
}

function upsertToolCall(
  toolCalls: WorkbenchToolCall[],
  update: WorkbenchToolCall,
): WorkbenchToolCall[] {
  const index = toolCalls.findIndex((toolCall) => toolCall.id === update.id);
  const next = {
    ...update,
    timeline: appendToolTimeline(index < 0 ? [] : (toolCalls[index]?.timeline ?? []), update),
  } satisfies WorkbenchToolCall;
  if (index < 0) return [...toolCalls, next];

  return toolCalls.map((toolCall, toolCallIndex) =>
    toolCallIndex === index
      ? {
          ...toolCall,
          ...stripUndefined(next),
          timeline: next.timeline,
        }
      : toolCall,
  );
}

function appendToolTimeline(
  timeline: WorkbenchToolTimelineEntry[],
  toolCall: WorkbenchToolCall,
): WorkbenchToolTimelineEntry[] {
  const status = toolCall.status ?? "updated";
  return [
    ...timeline,
    {
      id: `tool:${toolCall.id}:${timeline.length}`,
      status,
      label: toolCall.title,
      timestamp: toolCall.updatedAt ?? toolCall.completedAt ?? toolCall.startedAt,
      summary: toolTraceSummary(toolCall),
      payload: toolCall.rawOutput ?? toolCall.rawInput,
    },
  ];
}

function activeToolCallIds(calls: WorkbenchToolCall[]): string[] {
  return calls
    .filter((toolCall) => toolCall.status !== "completed" && toolCall.status !== "failed")
    .map((toolCall) => toolCall.id);
}

function recentToolCallIds(calls: WorkbenchToolCall[]): string[] {
  return capEnd(
    calls
      .filter((toolCall) => toolCall.status === "completed" || toolCall.status === "failed")
      .map((toolCall) => toolCall.id),
    maxRecentToolCalls,
  );
}

function upsertApproval(
  approvals: WorkbenchApprovalRequest[],
  update: WorkbenchApprovalRequest,
): WorkbenchApprovalRequest[] {
  const index = approvals.findIndex((approval) => approval.requestId === update.requestId);
  if (index < 0) return [...approvals, update];
  return approvals.map((approval, approvalIndex) => (approvalIndex === index ? update : approval));
}

function updateActiveToolCall(
  run: WorkbenchRunState,
  toolCall: WorkbenchToolCall,
): WorkbenchRunState {
  if (toolCall.status === "completed" || toolCall.status === "failed") {
    return run.activeToolCallId === toolCall.id ? { ...run, activeToolCallId: undefined } : run;
  }
  return {
    ...run,
    activeToolCallId: toolCall.id,
    status: run.status === "idle" ? "running" : run.status,
  };
}

function mergeSession(
  session: WorkbenchState["agent"]["session"],
  update: Partial<NonNullable<WorkbenchState["agent"]["session"]>>,
): WorkbenchState["agent"]["session"] {
  if (!session) return undefined;
  return { ...session, ...stripUndefined(update) };
}

function mergeInspector(
  inspector: WorkbenchState["inspector"],
  update: Partial<WorkbenchState["inspector"]>,
): WorkbenchState["inspector"] {
  return {
    systemPrompt: update.systemPrompt ?? inspector.systemPrompt,
    contextEntries: update.contextEntries ?? inspector.contextEntries,
    rawMessages: update.rawMessages ?? inspector.rawMessages,
    selectedEntryId: update.selectedEntryId ?? inspector.selectedEntryId,
  };
}

function rawMessageEntries(messages: WorkbenchMessage[]): WorkbenchInspectorEntry[] {
  return messages.map((message, index) => ({
    id: `raw-message:${message.id}`,
    title: `${index + 1}. ${message.role}`,
    content: message,
    updatedAt: message.updatedAt ?? message.createdAt,
  }));
}

function mergeModel(
  model: WorkbenchModelState,
  update: Partial<WorkbenchModelState>,
): WorkbenchModelState {
  return {
    currentModelId: update.currentModelId ?? model.currentModelId,
    availableModels: update.availableModels ?? model.availableModels,
    recentModelIds: update.recentModelIds ?? model.recentModelIds,
  };
}

function mergeSessionMode(
  sessionMode: WorkbenchSessionModeState,
  update: Partial<WorkbenchSessionModeState>,
): WorkbenchSessionModeState {
  return {
    currentModeId: update.currentModeId ?? sessionMode.currentModeId,
    availableModes: update.availableModes ?? sessionMode.availableModes,
  };
}

function mergeAccessLevel(
  access: WorkbenchAccessLevelState,
  update: Partial<WorkbenchAccessLevelState>,
): WorkbenchAccessLevelState {
  return {
    currentAccessLevel: update.currentAccessLevel ?? access.currentAccessLevel,
    availableAccessLevels: update.availableAccessLevels ?? access.availableAccessLevels,
  };
}

function toolCallFromUpdate(
  sessionId: string,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
): WorkbenchToolCall {
  const status = update.status ?? undefined;
  const updatedAt = new Date().toISOString();
  return {
    id: update.toolCallId,
    title: update.title ?? update.toolCallId,
    kind: update.kind ?? undefined,
    status,
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
    content: toolContentText(update.content ?? undefined),
    locations: update.locations?.map(
      (location): WorkbenchToolLocation => ({
        path: location.path,
        line: location.line ?? undefined,
      }),
    ),
    startedAt: update.sessionUpdate === "tool_call" ? updatedAt : undefined,
    updatedAt,
    completedAt: status === "completed" || status === "failed" ? updatedAt : undefined,
    provenance: {
      source: "acp",
      protocol: "acp",
      sessionId,
      toolCallId: update.toolCallId,
      updateType: update.sessionUpdate,
    },
    metadata: recordMetadata(update._meta),
  };
}

function toolReferenceEvents(sessionId: string, toolCall: WorkbenchToolCall): WorkbenchEvent[] {
  const kind =
    toolCall.status === "completed" || toolCall.status === "failed"
      ? "tool_result_ref"
      : "tool_call_ref";
  return [
    {
      type: "message_part_delta",
      messageId: `${sessionId}:tools`,
      role: "tool",
      part: {
        kind,
        toolCallId: toolCall.id,
        label: toolCall.title,
        status: toolCall.status,
      },
      status: "complete",
      provenance: toolCall.provenance,
    },
  ];
}

function messagePartDelta(
  sessionId: string,
  messageId: string,
  role: WorkbenchRole,
  part: WorkbenchMessagePart,
): WorkbenchEvent[] {
  const emptyText = isTextualPart(part) && part.text.length === 0;
  return emptyText
    ? []
    : [
        {
          type: "message_part_delta",
          messageId,
          role,
          part,
          provenance: {
            source: "acp",
            protocol: "acp",
            sessionId,
            messageId,
          },
        },
      ];
}

function planEntry(entry: { content: string; priority?: string; status: string }, index: number) {
  return {
    id: `plan:${index}`,
    content: entry.content,
    priority: entry.priority === "high" || entry.priority === "low" ? entry.priority : "medium",
    status:
      entry.status === "completed" || entry.status === "in_progress" ? entry.status : "pending",
  } satisfies WorkbenchPlanEntry;
}

function planUpdateEvents(
  plan: Extract<SessionUpdate, { sessionUpdate: "plan_update" }>["plan"],
): WorkbenchEvent[] {
  switch (plan.type) {
    case "items":
      return [{ type: "plan_replaced", entries: plan.entries.map(planEntry) }];
    case "markdown":
      return [{ type: "plan_replaced", entries: markdownPlanEntries(plan.content) }];
    case "file":
      return [
        {
          type: "plan_replaced",
          entries: [
            {
              id: plan.id,
              content: `Plan file: ${plan.uri}`,
              priority: "medium",
              status: "pending",
            },
          ],
        },
      ];
  }
}

function markdownPlanEntries(markdown: string): WorkbenchPlanEntry[] {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line));
  return (lines.length ? lines : [markdown.trim() || "Plan updated"]).map((line, index) => ({
    id: `plan:${index}`,
    content: line.replace(/^[-*]\s+/, ""),
    priority: "medium",
    status: "pending",
  }));
}

function contentBlockText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource_link":
      return content.title ?? content.name ?? content.uri;
    case "resource":
      return `Resource: ${content.resource.uri}`;
    case "image":
      return `[image ${content.mimeType}]`;
    case "audio":
      return `[audio ${content.mimeType}]`;
  }
}

function toolContentText(content: ToolCallContent[] | undefined): string | undefined {
  if (!content?.length) return undefined;
  return content
    .map((item) => {
      switch (item.type) {
        case "content":
          return contentBlockText(item.content);
        case "diff":
          return item.path ? `Diff: ${item.path}` : "Diff";
        case "terminal":
          return `Terminal: ${item.terminalId}`;
      }
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function toolTraceSummary(toolCall: WorkbenchToolCall): string {
  return (
    toolCall.error ??
    toolCall.content ??
    valuePreview(toolCall.rawOutput) ??
    valuePreview(toolCall.rawInput) ??
    toolCall.status ??
    "running"
  );
}

function valuePreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function acpDebugEvent(sessionId: string, update: unknown): WorkbenchEvent {
  const type = readString(readRecord(update).sessionUpdate) ?? "unknown_update";
  return {
    type: "debug_event_recorded",
    debugEvent: {
      id: `acp:${sessionId}:${type}:${debugEventSuffix(update)}`,
      source: "acp",
      type,
      label: type.replaceAll("_", " "),
      payload: update,
    },
  };
}

function debugEventSuffix(update: unknown): string {
  const record = readRecord(update);
  const messageId = readString(record.messageId);
  if (messageId) return messageId;
  const toolCallId = readString(record.toolCallId);
  if (toolCallId) return toolCallId;
  const title = readString(record.title);
  if (title) return title;
  return "update";
}

function acpMetadataEvents(update: SessionUpdate): WorkbenchEvent[] {
  const metadata = readUpdateMetadata(update._meta);
  if (!metadata) return [];

  return [
    ...toArray(metadata.debug).map((debugEvent) => ({
      type: "debug_event_recorded" as const,
      debugEvent,
    })),
    ...toArray(metadata.observationalMemory).map((entry) => ({
      type: "observational_memory_updated" as const,
      entry,
    })),
    ...systemPromptEvents(metadata.systemPrompt),
    ...inspectorEntryEvents(metadata.contextEntries, metadata.rawMessages),
    ...modelEvents(metadata.model),
    ...modeEvents(metadata.mode),
    ...accessEvents(metadata.access),
    ...threadEvents(metadata.threads, metadata.activeThreadId),
  ];
}

function readUpdateMetadata(meta: unknown): PeWorkbenchUpdateMetadata | undefined {
  if (!isRecord(meta)) return undefined;
  const metadata = meta[peWorkbenchUpdateMetadataKey];
  if (!isRecord(metadata)) return undefined;
  return {
    debug: readDebugEvents(metadata.debug),
    observationalMemory: readObservationMemoryEntries(metadata.observationalMemory),
    systemPrompt: readSystemPrompt(metadata.systemPrompt),
    contextEntries: readInspectorEntries(metadata.contextEntries),
    rawMessages: readInspectorEntries(metadata.rawMessages),
    model: readModel(metadata.model),
    mode: readMode(metadata.mode),
    access: readAccessLevel(metadata.access),
    threads: readThreads(metadata.threads),
    activeThreadId:
      typeof metadata.activeThreadId === "string" ? metadata.activeThreadId : undefined,
  };
}

const projectionDebugSourceSchema = z
  .enum(["acp", "runtime", "workbench", "transport", "ui"])
  .catch("acp");
const projectionAccessLevelSchema = z.enum(["read-only", "ask", "trusted"]);
const projectionDebugEventSchema = z
  .object({
    id: z.string(),
    source: projectionDebugSourceSchema.optional().default("acp"),
    type: z.string(),
    label: z.string().optional(),
    timestamp: z.string().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();
const projectionObservationMemoryStatusSchema = z.enum([
  "loading",
  "complete",
  "failed",
  "disconnected",
  "buffering",
  "buffering-complete",
  "buffering-failed",
  "activated",
]);
const projectionObservationMemoryEntrySchema = z
  .object({
    id: z.string(),
    kind: z.enum(["observation", "reflection"]),
    status: projectionObservationMemoryStatusSchema,
    title: z.string().optional(),
    summary: z.string().optional(),
    observedTokens: z.number().optional(),
    compressionRatio: z.number().optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
    metadata: z.unknown().optional(),
    raw: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchObservationMemoryEntry => ({
      ...value,
      metadata: recordMetadata(value.metadata),
    }),
  );
const projectionSystemPromptSchema = z
  .object({
    content: z.string(),
    source: z.string().optional(),
    updatedAt: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchSystemPromptSnapshot => ({
      content: value.content,
      source: value.source,
      updatedAt: value.updatedAt,
      metadata: recordMetadata(value.metadata),
    }),
  );
const projectionInspectorEntrySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.unknown(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
const projectionModelInfoSchema = z
  .object({
    id: z.string(),
    provider: z.string().optional(),
    displayName: z.string().optional(),
    variant: z.string().optional(),
    disabled: z.boolean().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchModelInfo => ({
      ...value,
      metadata: recordMetadata(value.metadata),
    }),
  );
const projectionModeInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchSessionModeInfo => ({
      ...value,
      metadata: recordMetadata(value.metadata),
    }),
  );
const projectionAccessLevelInfoSchema = z
  .object({
    id: projectionAccessLevelSchema,
    name: z.string(),
    description: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchAccessLevelInfo => ({
      ...value,
      metadata: recordMetadata(value.metadata),
    }),
  );
const projectionThreadSchema = z
  .object({
    threadId: z.string(),
    sessionId: z.string().optional(),
    resourceId: z.string().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
    updatedAt: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .transform(
    (value): WorkbenchThreadInfo => ({
      ...value,
      metadata: recordMetadata(value.metadata),
    }),
  );
const projectionModelSchema = z
  .object({
    currentModelId: z.string().optional(),
    availableModels: z.array(projectionModelInfoSchema).optional(),
    recentModelIds: z.array(z.string()).optional(),
  })
  .passthrough();
const projectionModeSchema = z
  .object({
    currentModeId: z.string().optional(),
    availableModes: z.array(projectionModeInfoSchema).optional(),
  })
  .passthrough();
const projectionAccessSchema = z
  .object({
    currentAccessLevel: projectionAccessLevelSchema.optional(),
    availableAccessLevels: z.array(projectionAccessLevelInfoSchema).optional(),
  })
  .passthrough();
const projectionAcpSessionUpdateSchema = z.object({ sessionUpdate: z.string() }).passthrough();

function readDebugEvents(value: unknown): WorkbenchDebugEvent | WorkbenchDebugEvent[] | undefined {
  const events = toArray(value).map(readDebugEvent).filter(isDefined);
  if (!events.length) return undefined;
  return Array.isArray(value) ? events : events[0];
}

function readDebugEvent(value: unknown): WorkbenchDebugEvent | undefined {
  const event = projectionDebugEventSchema.safeParse(value);
  return event.success ? event.data : undefined;
}

function readObservationMemoryEntries(
  value: unknown,
): WorkbenchObservationMemoryEntry | WorkbenchObservationMemoryEntry[] | undefined {
  const entries = toArray(value).map(readObservationMemoryEntry).filter(isDefined);
  if (!entries.length) return undefined;
  return Array.isArray(value) ? entries : entries[0];
}

function readObservationMemoryEntry(value: unknown): WorkbenchObservationMemoryEntry | undefined {
  const entry = projectionObservationMemoryEntrySchema.safeParse(value);
  return entry.success ? entry.data : undefined;
}

function readSystemPrompt(value: unknown): WorkbenchSystemPromptSnapshot | undefined {
  const systemPrompt = projectionSystemPromptSchema.safeParse(value);
  return systemPrompt.success ? systemPrompt.data : undefined;
}

function readInspectorEntries(value: unknown): WorkbenchInspectorEntry[] | undefined {
  const entries = toArray(value).map(readInspectorEntry).filter(isDefined);
  return entries.length ? entries : undefined;
}

function readInspectorEntry(value: unknown): WorkbenchInspectorEntry | undefined {
  const entry = projectionInspectorEntrySchema.safeParse(value);
  return entry.success ? entry.data : undefined;
}

function readModel(value: unknown): Partial<WorkbenchModelState> | undefined {
  const model = projectionModelSchema.safeParse(value);
  return model.success ? model.data : undefined;
}

function readMode(value: unknown): Partial<WorkbenchSessionModeState> | undefined {
  const mode = projectionModeSchema.safeParse(value);
  return mode.success ? mode.data : undefined;
}

function readAccessLevel(value: unknown): Partial<WorkbenchAccessLevelState> | undefined {
  const access = projectionAccessSchema.safeParse(value);
  return access.success ? access.data : undefined;
}

function readThreads(value: unknown): WorkbenchThreadInfo[] | undefined {
  const threads = toArray(value).map(readThread).filter(isDefined);
  return threads.length ? threads : undefined;
}

function readThread(value: unknown): WorkbenchThreadInfo | undefined {
  const thread = projectionThreadSchema.safeParse(value);
  return thread.success ? thread.data : undefined;
}

function systemPromptEvents(
  systemPrompt: WorkbenchSystemPromptSnapshot | undefined,
): WorkbenchEvent[] {
  return systemPrompt ? [{ type: "inspector_updated", inspector: { systemPrompt } }] : [];
}

function inspectorEntryEvents(
  contextEntries: WorkbenchInspectorEntry[] | undefined,
  rawMessages: WorkbenchInspectorEntry[] | undefined,
): WorkbenchEvent[] {
  return contextEntries || rawMessages
    ? [{ type: "inspector_updated", inspector: { contextEntries, rawMessages } }]
    : [];
}

function modelEvents(model: Partial<WorkbenchModelState> | undefined): WorkbenchEvent[] {
  return model ? [{ type: "model_state_updated", model }] : [];
}

function modeEvents(mode: Partial<WorkbenchSessionModeState> | undefined): WorkbenchEvent[] {
  return mode ? [{ type: "session_mode_updated", sessionMode: mode }] : [];
}

function accessEvents(access: Partial<WorkbenchAccessLevelState> | undefined): WorkbenchEvent[] {
  return access ? [{ type: "access_level_updated", access }] : [];
}

function threadEvents(
  threads: WorkbenchThreadInfo[] | undefined,
  activeThreadId: string | undefined,
): WorkbenchEvent[] {
  return threads ? [{ type: "threads_replaced", threads, activeThreadId }] : [];
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

function upsertThread(
  threads: WorkbenchThreadInfo[],
  update: WorkbenchThreadInfo,
): WorkbenchThreadInfo[] {
  const index = threads.findIndex((thread) => thread.threadId === update.threadId);
  if (index < 0) return [...threads, update];
  return threads.map((thread, threadIndex) =>
    threadIndex === index ? { ...thread, ...stripUndefined(update) } : thread,
  );
}

function upsertObservationMemory(
  entries: WorkbenchObservationMemoryEntry[],
  update: WorkbenchObservationMemoryEntry,
): WorkbenchObservationMemoryEntry[] {
  const index = entries.findIndex((entry) => entry.id === update.id);
  if (index < 0) return [...entries, update];
  return entries.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, ...stripUndefined(update) } : entry,
  );
}

function timestampDebugEvent(event: WorkbenchDebugEvent): WorkbenchDebugEvent {
  return event.timestamp ? event : { ...event, timestamp: new Date().toISOString() };
}

function recordMetadata(value: unknown): WorkbenchJsonObject | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, WorkbenchJsonObject[string]] =>
      isJsonValue(entry[1]),
    ),
  );
}

function isJsonValue(value: unknown): value is WorkbenchJsonObject[string] {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readAcpSessionUpdate(value: unknown): SessionUpdate | undefined {
  return isAcpSessionUpdate(value) ? value : undefined;
}

function isAcpSessionUpdate(value: unknown): value is SessionUpdate {
  const update = projectionAcpSessionUpdateSchema.safeParse(value);
  if (!update.success) return false;
  const sessionUpdate = update.data.sessionUpdate;
  return (
    sessionUpdate === "user_message_chunk" ||
    sessionUpdate === "agent_message_chunk" ||
    sessionUpdate === "agent_thought_chunk" ||
    sessionUpdate === "tool_call" ||
    sessionUpdate === "tool_call_update" ||
    sessionUpdate === "plan" ||
    sessionUpdate === "plan_update" ||
    sessionUpdate === "plan_removed" ||
    sessionUpdate === "available_commands_update" ||
    sessionUpdate === "current_mode_update" ||
    sessionUpdate === "config_option_update" ||
    sessionUpdate === "session_info_update" ||
    sessionUpdate === "usage_update"
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capEnd<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = { ...value };
  for (const key in result) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}
