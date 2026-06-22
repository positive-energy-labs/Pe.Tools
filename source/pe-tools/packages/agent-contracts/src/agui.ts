import type {
  WorkbenchEvent,
  WorkbenchInspectorEntry,
  WorkbenchJsonObject,
  WorkbenchMessage,
  WorkbenchMessagePart,
  WorkbenchObservationMemoryEntry,
  WorkbenchPlanEntry,
  WorkbenchProvenance,
  WorkbenchRole,
  WorkbenchState,
  WorkbenchSystemPromptSnapshot,
  WorkbenchToolCall,
} from "./contracts.ts";

export interface AgUiProjectionOptions {
  threadId?: string;
  sessionId?: string;
  cwd?: string;
  title?: string;
  eventIndex?: number;
}

export function agUiEventToWorkbenchEvents(
  state: WorkbenchState,
  event: unknown,
  options: AgUiProjectionOptions = {},
): WorkbenchEvent[] {
  const record = readEventRecord(event);
  if (!record) return [];

  const timestamp = readString(record.timestamp) ?? new Date().toISOString();
  const provenance = agUiProvenance(record, options);
  const events: WorkbenchEvent[] = [debugEvent(record, options, timestamp)];

  switch (record.type) {
    case "RUN_STARTED":
      return [...events, ...runStartedEvents(record, options, state, timestamp)];
    case "RUN_FINISHED":
      return [
        ...events,
        {
          type: "run_status_changed",
          status: isInterruptOutcome(record.outcome) ? "waiting" : "idle",
          timestamp,
        },
      ];
    case "RUN_ERROR":
      return [
        ...events,
        {
          type: "run_status_changed",
          status: "error",
          timestamp,
        },
        {
          type: "error",
          message: readString(record.message) ?? "AG-UI run failed.",
        },
      ];
    case "RUN_CANCELLED":
      return [
        ...events,
        { type: "run_status_changed", status: "idle", timestamp },
        { type: "approvals_cleared", reason: "AG-UI run cancelled" },
      ];
    case "MESSAGES_SNAPSHOT":
      return [...events, messagesSnapshotEvent(record, provenance, timestamp)];
    case "STATE_SNAPSHOT":
      return [...events, stateSnapshotEvent(record, timestamp)];
    case "TEXT_MESSAGE_CONTENT":
      return [
        ...events,
        ...textDeltaEvents(record, "assistant", { kind: "text" }, provenance, timestamp),
      ];
    case "TEXT_MESSAGE_END":
      return [...events, ...completeMessageEvents(state, record, timestamp)];
    case "THINKING_TEXT_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_CONTENT":
      return [
        ...events,
        ...textDeltaEvents(record, "thought", { kind: "reasoning" }, provenance, timestamp),
      ];
    case "THINKING_TEXT_MESSAGE_END":
    case "REASONING_MESSAGE_END":
      return [...events, ...completeMessageEvents(state, record, timestamp)];
    case "TOOL_CALL_START":
      return [...events, toolCallEvent(state, record, provenance, timestamp, "in_progress")];
    case "TOOL_CALL_ARGS":
      return [...events, toolArgsEvent(state, record, provenance, timestamp)];
    case "TOOL_CALL_END":
      return [...events, toolCallEvent(state, record, provenance, timestamp, "completed")];
    case "TOOL_CALL_RESULT":
      return [...events, ...toolResultEvents(state, record, provenance, timestamp)];
    case "CUSTOM":
      return [...events, ...customEvents(state, record, provenance, timestamp)];
    default:
      return events;
  }
}

function runStartedEvents(
  event: AgUiEventRecord,
  options: AgUiProjectionOptions,
  state: WorkbenchState,
  timestamp: string,
): WorkbenchEvent[] {
  const input = readRecord(event.input);
  const threadId =
    readString(event.threadId) ??
    readString(input?.threadId) ??
    options.threadId ??
    state.threads.activeThreadId ??
    "ag-ui";
  const sessionId = options.sessionId ?? `ag-ui:${threadId}`;
  const scope = runtimeScope(input, options, state);
  const title = options.title ?? `AG-UI ${shortId(threadId)}`;

  return [
    {
      type: "session_started",
      session: {
        sessionId,
        cwd: scope.cwd,
        additionalDirectories: scope.additionalDirectories,
        title,
        updatedAt: timestamp,
        metadata: { protocol: "ag-ui" },
      },
      thread: {
        threadId,
        sessionId,
        cwd: scope.cwd,
        title,
        updatedAt: timestamp,
        metadata: { protocol: "ag-ui" },
      },
    },
    {
      type: "run_status_changed",
      status: "running",
      timestamp,
    },
  ];
}

function messagesSnapshotEvent(
  event: AgUiEventRecord,
  provenance: WorkbenchProvenance,
  timestamp: string,
): WorkbenchEvent {
  const messages = Array.isArray(event.messages)
    ? event.messages.flatMap((message, index) => agUiMessage(message, index, provenance, timestamp))
    : [];
  return { type: "transcript_replaced", messages };
}

function stateSnapshotEvent(event: AgUiEventRecord, timestamp: string): WorkbenchEvent {
  return {
    type: "inspector_updated",
    inspector: {
      contextEntries: [
        {
          id: "ag-ui-state",
          title: "AG-UI state",
          content: event.snapshot ?? {},
          updatedAt: timestamp,
        },
      ],
    },
  };
}

function textDeltaEvents(
  event: AgUiEventRecord,
  role: WorkbenchRole,
  partBase: { kind: "text" | "reasoning" | "thought" },
  provenance: WorkbenchProvenance,
  timestamp: string,
): WorkbenchEvent[] {
  const delta = readString(event.delta);
  if (!delta) return [];
  return [
    {
      type: "message_part_delta",
      messageId: readString(event.messageId) ?? `${role}:stream`,
      role,
      part: { ...partBase, text: delta },
      status: "streaming",
      timestamp,
      provenance,
    },
  ];
}

function completeMessageEvents(
  state: WorkbenchState,
  event: AgUiEventRecord,
  timestamp: string,
): WorkbenchEvent[] {
  const messageId = readString(event.messageId);
  if (!messageId) return [];
  const message = state.transcript.messages.find((candidate) => candidate.id === messageId);
  if (!message) return [];
  return [
    {
      type: "message_updated",
      message: { ...message, status: "complete", updatedAt: timestamp },
    },
  ];
}

function toolCallEvent(
  state: WorkbenchState,
  event: AgUiEventRecord,
  provenance: WorkbenchProvenance,
  timestamp: string,
  status: WorkbenchToolCall["status"],
): WorkbenchEvent {
  return {
    type: "tool_call_updated",
    toolCall: toolCallFromEvent(state, event, provenance, timestamp, status),
  };
}

function toolArgsEvent(
  state: WorkbenchState,
  event: AgUiEventRecord,
  provenance: WorkbenchProvenance,
  timestamp: string,
): WorkbenchEvent {
  const toolCallId = readString(event.toolCallId) ?? "tool";
  const previous = findToolCall(state, toolCallId);
  const delta = readString(event.delta) ?? valuePreview(event.delta) ?? "";
  return {
    type: "tool_call_updated",
    toolCall: {
      ...toolCallFromEvent(state, event, provenance, timestamp, "in_progress"),
      rawInput: `${stringifyRaw(previous?.rawInput)}${delta}`,
    },
  };
}

function toolResultEvents(
  state: WorkbenchState,
  event: AgUiEventRecord,
  provenance: WorkbenchProvenance,
  timestamp: string,
): WorkbenchEvent[] {
  const toolCallId = readString(event.toolCallId) ?? "tool";
  const content = readString(event.content) ?? valuePreview(event.content) ?? "";
  const toolCall = {
    ...toolCallFromEvent(state, event, provenance, timestamp, "completed"),
    rawOutput: event.content,
    content,
    completedAt: timestamp,
  } satisfies WorkbenchToolCall;

  return [
    { type: "tool_call_updated", toolCall },
    {
      type: "message_part_delta",
      messageId: readString(event.messageId) ?? `${toolCallId}:result`,
      role: "tool",
      part: {
        kind: "tool_result_ref",
        toolCallId,
        label: toolCall.title,
        status: "completed",
      },
      status: "complete",
      timestamp,
      provenance,
    },
  ];
}

function customEvents(
  state: WorkbenchState,
  event: AgUiEventRecord,
  provenance: WorkbenchProvenance,
  timestamp: string,
): WorkbenchEvent[] {
  const name = readString(event.name);
  if (name === "runtime.plan.updated") {
    return [{ type: "plan_replaced", entries: planEntries(event.value) }];
  }
  if (name === "runtime.workbench.metadata") {
    return workbenchMetadataEvents(event.value);
  }
  if (name === "runtime.plan.requested") {
    const value = readRecord(event.value);
    return [
      {
        type: "plan_replaced",
        entries: [
          {
            id: "plan:requested",
            content: readString(value?.plan) ?? readString(value?.title) ?? "Plan requested.",
            status: "pending",
            priority: "medium",
          },
        ],
      },
    ];
  }
  if (name === "runtime.error") {
    const value = readRecord(event.value);
    const error = readRecord(value?.error);
    return [
      {
        type: "error",
        message: readString(error?.message) ?? readString(value?.error) ?? "Runtime error.",
      },
    ];
  }
  if (name === "runtime.tool.update" || name === "runtime.tool.shell_output") {
    const value = readRecord(event.value);
    const toolCallId = readString(value?.toolCallId);
    if (!toolCallId) return [];
    const payload = value?.value;
    const previous = findToolCall(state, toolCallId);
    const output = name === "runtime.tool.shell_output" ? readRecord(payload)?.output : undefined;
    const content = readString(output) ?? valuePreview(payload) ?? "";
    return [
      {
        type: "tool_call_updated",
        toolCall: {
          id: toolCallId,
          title: previous?.title ?? toolCallId,
          status: previous?.status ?? "in_progress",
          rawInput: previous?.rawInput,
          rawOutput:
            name === "runtime.tool.shell_output"
              ? `${stringifyRaw(previous?.rawOutput)}${content}`
              : payload,
          content,
          startedAt: previous?.startedAt,
          updatedAt: timestamp,
          provenance: { ...provenance, toolCallId, updateType: name },
        },
      },
    ];
  }
  return [];
}

function workbenchMetadataEvents(value: unknown): WorkbenchEvent[] {
  const metadata = readRecord(value);
  if (!metadata) return [];

  const systemPrompt = workbenchSystemPrompt(metadata.systemPrompt);
  const contextEntries = workbenchInspectorEntries(metadata.contextEntries);
  const rawMessages = workbenchInspectorEntries(metadata.rawMessages);
  const memoryEntries = toArray(metadata.observationalMemory).flatMap(workbenchMemoryEntry);

  return [
    ...memoryEntries.map((entry) => ({
      type: "observational_memory_updated" as const,
      entry,
    })),
    ...(systemPrompt || contextEntries || rawMessages
      ? [
          {
            type: "inspector_updated" as const,
            inspector: {
              ...(systemPrompt ? { systemPrompt } : {}),
              ...(contextEntries ? { contextEntries } : {}),
              ...(rawMessages ? { rawMessages } : {}),
            },
          },
        ]
      : []),
  ];
}

function workbenchSystemPrompt(value: unknown): WorkbenchSystemPromptSnapshot | undefined {
  const record = readRecord(value);
  const content = readString(record?.content);
  if (!content) return undefined;
  return {
    content,
    source: readString(record?.source),
    updatedAt: readString(record?.updatedAt),
    metadata: readJsonObject(record?.metadata),
  };
}

function workbenchInspectorEntries(value: unknown): WorkbenchInspectorEntry[] | undefined {
  const entries = toArray(value).flatMap((entry): WorkbenchInspectorEntry[] => {
    const record = readRecord(entry);
    const id = readString(record?.id);
    const title = readString(record?.title);
    if (!id || !title) return [];
    return [
      {
        id,
        title,
        content: record?.content,
        updatedAt: readString(record?.updatedAt),
      },
    ];
  });
  return entries.length > 0 ? entries : undefined;
}

function workbenchMemoryEntry(value: unknown): WorkbenchObservationMemoryEntry[] {
  const record = readRecord(value);
  const id = readString(record?.id);
  const kind =
    record?.kind === "reflection"
      ? "reflection"
      : record?.kind === "observation"
        ? "observation"
        : undefined;
  const status = workbenchMemoryStatus(record?.status);
  if (!id || !kind || !status) return [];
  return [
    {
      id,
      kind,
      status,
      title: readString(record?.title),
      summary: readString(record?.summary),
      observedTokens: readFiniteNumber(record?.observedTokens),
      compressionRatio: readFiniteNumber(record?.compressionRatio),
      durationMs: readFiniteNumber(record?.durationMs),
      error: readString(record?.error),
      metadata: readJsonObject(record?.metadata),
      raw: record?.raw,
    },
  ];
}

function workbenchMemoryStatus(
  value: unknown,
): WorkbenchObservationMemoryEntry["status"] | undefined {
  switch (value) {
    case "loading":
    case "complete":
    case "failed":
    case "disconnected":
    case "buffering":
    case "buffering-complete":
    case "buffering-failed":
    case "activated":
      return value;
    default:
      return undefined;
  }
}

function toolCallFromEvent(
  state: WorkbenchState,
  event: AgUiEventRecord,
  provenance: WorkbenchProvenance,
  timestamp: string,
  status: WorkbenchToolCall["status"],
): WorkbenchToolCall {
  const toolCallId = readString(event.toolCallId) ?? "tool";
  const previous = findToolCall(state, toolCallId);
  const title = readString(event.toolCallName) ?? previous?.title ?? toolCallId;
  return {
    id: toolCallId,
    title,
    status,
    rawInput: previous?.rawInput,
    rawOutput: previous?.rawOutput,
    content: previous?.content,
    startedAt: previous?.startedAt ?? timestamp,
    updatedAt: timestamp,
    completedAt: status === "completed" || status === "failed" ? timestamp : undefined,
    parentMessageId: readString(event.parentMessageId) ?? previous?.parentMessageId,
    provenance: { ...provenance, toolCallId, updateType: event.type },
  };
}

function agUiMessage(
  value: unknown,
  index: number,
  provenance: WorkbenchProvenance,
  timestamp: string,
): WorkbenchMessage[] {
  const record = readRecord(value);
  if (!record) return [];
  const role = workbenchRole(record.role);
  const id = readString(record.id) ?? `ag-ui-message:${index}`;
  const parts = messageParts(record);
  return [
    {
      id,
      role,
      parts:
        parts.length > 0
          ? parts
          : [{ kind: "raw", value: record, label: "AG-UI message", provenance }],
      status: "complete",
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: { ...provenance, messageId: id },
    },
  ];
}

function messageParts(message: Record<string, unknown>): WorkbenchMessagePart[] {
  const content = message.content;
  if (typeof content === "string") return content ? [{ kind: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];

  return content.flatMap((part): WorkbenchMessagePart[] => {
    const record = readRecord(part);
    if (!record) return [];
    const type = readString(record.type);
    if (type === "text" && typeof record.text === "string")
      return [{ kind: "text", text: record.text }];
    if ((type === "reasoning" || type === "thinking") && typeof record.text === "string")
      return [{ kind: "reasoning", text: record.text }];
    return [{ kind: "raw", value: record, label: type ?? "content" }];
  });
}

function planEntries(value: unknown): WorkbenchPlanEntry[] {
  const tasks = Array.isArray(value) ? value : readArray(readRecord(value)?.tasks);
  if (!tasks) {
    const content = readString(value) ?? valuePreview(value) ?? "Plan updated.";
    return [{ id: "plan:0", content, priority: "medium", status: "pending" }];
  }

  return tasks.map((task, index) => {
    const record = readRecord(task);
    const content =
      readString(record?.content) ??
      readString(record?.title) ??
      readString(task) ??
      valuePreview(task) ??
      `Step ${index + 1}`;
    const status = readString(record?.status);
    const priority = readString(record?.priority);
    return {
      id: readString(record?.id) ?? `plan:${index}`,
      content,
      priority: priority === "high" || priority === "low" ? priority : "medium",
      status: status === "completed" || status === "in_progress" ? status : "pending",
    };
  });
}

function debugEvent(
  event: AgUiEventRecord,
  options: AgUiProjectionOptions,
  timestamp: string,
): WorkbenchEvent {
  const suffix =
    readNumber(event.sequence)?.toString() ??
    options.eventIndex?.toString() ??
    readString(event.messageId) ??
    readString(event.toolCallId) ??
    "event";
  return {
    type: "debug_event_recorded",
    debugEvent: {
      id: `ag-ui:${options.threadId ?? "thread"}:${event.type}:${suffix}`,
      source: "ag-ui",
      type: event.type,
      label: event.type.replaceAll("_", " ").toLowerCase(),
      timestamp,
      payload: event,
    },
  };
}

function agUiProvenance(
  event: AgUiEventRecord,
  options: AgUiProjectionOptions,
): WorkbenchProvenance {
  return {
    source: "ag-ui",
    protocol: "ag-ui",
    sessionId: options.sessionId,
    threadId: readString(event.threadId) ?? options.threadId,
    messageId: readString(event.messageId),
    toolCallId: readString(event.toolCallId),
    updateType: event.type,
  };
}

function runtimeScope(
  input: Record<string, unknown> | undefined,
  options: AgUiProjectionOptions,
  state: WorkbenchState,
) {
  const forwardedProps = readRecord(input?.forwardedProps);
  const pea = readRecord(forwardedProps?.pea);
  return {
    cwd:
      readString(pea?.cwd) ??
      readString(forwardedProps?.cwd) ??
      options.cwd ??
      state.agent.session?.cwd ??
      "",
    additionalDirectories:
      readStringArray(pea?.additionalDirectories) ??
      readStringArray(forwardedProps?.additionalDirectories) ??
      [],
  };
}

function workbenchRole(value: unknown): WorkbenchRole {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool")
    return value;
  if (value === "developer") return "system";
  return "assistant";
}

function findToolCall(state: WorkbenchState, toolCallId: string): WorkbenchToolCall | undefined {
  return state.tools.calls.find((toolCall) => toolCall.id === toolCallId);
}

function isInterruptOutcome(value: unknown): boolean {
  return readString(readRecord(value)?.type) === "interrupt";
}

type AgUiEventRecord = Record<string, unknown> & { type: string };

function readEventRecord(value: unknown): AgUiEventRecord | undefined {
  const record = readRecord(value);
  return typeof record?.type === "string" ? (record as AgUiEventRecord) : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readJsonObject(value: unknown): WorkbenchJsonObject | undefined {
  return readRecord(value) as WorkbenchJsonObject | undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function valuePreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function stringifyRaw(value: unknown): string {
  return value === undefined || value === null
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}
