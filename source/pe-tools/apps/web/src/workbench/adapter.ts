import {
  createWorkbenchState,
  type WorkbenchAccessLevel,
  type WorkbenchApprovalOption,
  type WorkbenchContextBreakdown,
  type WorkbenchContextItem,
  type WorkbenchContextSegment,
  type WorkbenchMemoryWindows,
  type WorkbenchMessage,
  type WorkbenchMessagePart,
  type WorkbenchObservationMemoryEntry,
  type WorkbenchPlanEntry,
  type WorkbenchState,
  type WorkbenchToolCall,
} from "@pe/agent-contracts";

import type {
  AgentControllerAvailableModel,
  KnownAgentControllerEvent,
  AgentControllerModeInfo,
  AgentControllerOMProgress,
  AgentControllerSessionState,
  AgentControllerThreadInfo,
  MastraDBMessage,
  MastraMessagePart,
  PermissionRules,
} from "@mastra/client-js";

/**
 * Client-side projection of mastra's native agent-controller into the `WorkbenchState` the Lens
 * renders. `@mastra/client-js` owns transport + the snapshot types (thread/model/mode/session
 * state, event, and message types. `hydrateWorkbenchState` builds the initial state from REST
 * snapshots; `applyAgentControllerEvent` reduces each known SSE event.
 * Both are pure so the provider can unit-test and replay them.
 */

type OmStatusWindows = Extract<KnownAgentControllerEvent, { type: "om_status" }>["windows"];
type AgentControllerTask = Extract<
  KnownAgentControllerEvent,
  { type: "task_updated" }
>["tasks"][number];

/** The `/pe/inspect` transparency payload (Pe-owned). */
export interface PeInspect {
  systemPrompt?: { content?: string; source?: string; updatedAt?: string };
  toolList?: { tools?: unknown[] };
  skills?: unknown[];
  observationalMemory?: Record<string, unknown>;
  contextWindow?: number;
  agents?: unknown[];
}

export interface HydrateInputs {
  controllerId: string;
  resourceId: string;
  label?: string;
  title?: string;
  threadId?: string;
  displayState?: AgentControllerSessionState;
  threads: AgentControllerThreadInfo[];
  messages: MastraDBMessage[];
  inspect: PeInspect;
  models: AgentControllerAvailableModel[];
  modes: AgentControllerModeInfo[];
  permissions?: PermissionRules;
}

// --- Hydration --------------------------------------------------------------------------------

export function hydrateWorkbenchState(inputs: HydrateInputs): WorkbenchState {
  const base = createWorkbenchState();
  const display: Partial<AgentControllerSessionState> = inputs.displayState ?? {};
  const threadId = inputs.threadId ?? display.threadId;

  const messages = inputs.messages.map((message) => toWorkbenchMessage(message, "complete"));
  const tools = collectTools(inputs.messages);
  const accessLevel = accessLevelFromPermissions(inputs.permissions);
  const breakdown = buildBreakdown(inputs.inspect, messages, display.omProgress);

  return {
    ...base,
    agent: {
      info: {
        name: inputs.label ?? inputs.controllerId,
        title: inputs.title ?? "Pea",
        runtime: inputs.title
          ? {
              id: inputs.controllerId,
              name: inputs.label ?? inputs.controllerId,
              title: inputs.title,
            }
          : undefined,
        capabilities: {
          threads: true,
          history: true,
          toolCalls: true,
          approvals: true,
          plans: true,
          rawToolIO: true,
          modelSwitching: true,
          sessionModes: true,
          accessLevels: true,
          observationalMemory: true,
          systemPromptInspection: true,
        },
        metadata: { commands: skillCommands(inputs.inspect.skills) },
      },
    },
    threads: {
      items: inputs.threads.map((thread) => ({
        threadId: thread.id,
        title: thread.title ?? shortId(thread.id),
        updatedAt: thread.updatedAt,
      })),
      activeThreadId: threadId,
      selectedThreadId: threadId,
      status: "loaded",
    },
    transcript: { messages, status: "loaded" },
    tools: {
      calls: tools,
      activeToolCallIds: activeToolIds(tools),
      recentToolCallIds: recentToolIds(tools),
      rawIoAvailable: true,
    },
    models: {
      currentModelId: display.modelId || undefined,
      availableModels: modelInfos(inputs.models),
      recentModelIds: [],
    },
    modes: {
      currentModeId: display.modeId,
      availableModes: inputs.modes.map((mode) => ({ id: mode.id, name: mode.name ?? mode.id })),
    },
    access: {
      currentAccessLevel: accessLevel,
      availableAccessLevels: ACCESS_LEVELS,
    },
    memory: { entries: configuredMemoryEntries(inputs.inspect.observationalMemory) },
    inspector: {
      systemPrompt: systemPromptSnapshot(inputs.inspect.systemPrompt),
      contextBreakdown: breakdown,
      contextEntries: [],
      rawMessages: [],
    },
    plans: { entries: planEntries(display.tasks ?? []) },
    uiStatus: {
      ...base.uiStatus,
      overall: { ...base.uiStatus.overall, status: display.running ? "running" : "idle" },
    },
  };
}

// --- Reducer ----------------------------------------------------------------------------------

export function applyAgentControllerEvent(
  state: WorkbenchState,
  event: KnownAgentControllerEvent,
): WorkbenchState {
  switch (event.type) {
    case "agent_start":
      return withRunStatus(state, "running");
    case "agent_end":
      // A suspended run is paused for HITL. Every terminal outcome clears projected running state.
      if (event.reason === "suspended") return state;
      return event.reason === "error" ? endRunWithError(state, "Run failed.") : endRun(state);
    case "message_start":
    case "message_update":
      return applyMessage(state, event.message, "streaming");
    case "message_end":
      return applyMessage(state, event.message, "complete");
    case "tool_start":
      return mergeTool(state, event.toolCallId, {
        title: event.toolName,
        rawInput: event.args,
        target: toolTargetHint(event.args),
        status: "in_progress",
        startedAt: nowIso(),
      });
    case "tool_input_start":
      return mergeTool(state, event.toolCallId, {
        title: event.toolName,
        status: "in_progress",
        startedAt: nowIso(),
      });
    case "tool_input_delta": {
      const existing = state.tools.calls.find((call) => call.id === event.toolCallId);
      const prior = typeof existing?.rawInput === "string" ? existing.rawInput : "";
      return mergeTool(state, event.toolCallId, {
        ...(event.toolName ? { title: event.toolName } : {}),
        rawInput: prior + stringify(event.argsTextDelta),
        status: "in_progress",
      });
    }
    case "tool_input_end":
      return state;
    case "tool_update":
      return mergeTool(state, event.toolCallId, {
        rawOutput: event.partialResult,
        status: "in_progress",
      });
    case "shell_output": {
      const existing = state.tools.calls.find((call) => call.id === event.toolCallId);
      return mergeTool(state, event.toolCallId, {
        content: (existing?.content ?? "") + event.output,
      });
    }
    case "tool_end":
      return resolveApprovalsFor(
        mergeTool(state, event.toolCallId, {
          rawOutput: event.result,
          status: event.isError ? "failed" : "completed",
          completedAt: nowIso(),
          ...(event.isError ? { error: stringify(event.result) } : {}),
        }),
        event.toolCallId,
      );
    case "tool_approval_required":
      return requestApproval(
        mergeTool(state, event.toolCallId, {
          title: event.toolName,
          rawInput: event.args,
          target: toolTargetHint(event.args),
          status: "pending",
        }),
        {
          requestId: `tool-approval:${event.toolCallId}`,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      );
    case "tool_suspended":
      return requestApproval(
        mergeTool(state, event.toolCallId, {
          title: event.toolName,
          rawInput: event.args,
          rawOutput: event.suspendPayload,
          target: toolTargetHint(event.args),
          status: "pending",
        }),
        {
          requestId: `tool-suspended:${event.toolCallId}`,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          suspendPayload: event.suspendPayload,
        },
      );
    case "task_updated":
      return { ...state, plans: { entries: planEntries(event.tasks) } };
    case "om_status":
      return patchMemoryWindows(state, memoryWindowsFromStatus(event.windows));
    case "om_observation_end":
      return upsertMemory(state, {
        id: `om:observation:${event.cycleId}`,
        kind: "observation",
        status: "complete",
        title: "Observation",
        summary: `Observed ${event.tokensObserved.toLocaleString()} tokens`,
        observedTokens: event.observationTokens,
        durationMs: event.durationMs,
      });
    case "om_reflection_end":
      return upsertMemory(state, {
        id: `om:reflection:${event.cycleId}`,
        kind: "reflection",
        status: "complete",
        title: "Reflection",
        summary: `Compressed to ${event.compressedTokens.toLocaleString()} tokens`,
        observedTokens: event.compressedTokens,
        durationMs: event.durationMs,
      });
    case "mode_changed":
      return { ...state, modes: { ...state.modes, currentModeId: event.modeId } };
    case "model_changed":
      return { ...state, models: { ...state.models, currentModelId: event.modelId } };
    case "state_changed":
      // Full-map rebroadcast from SessionState — route slices select their `route:*` key.
      return { ...state, sessionState: { values: event.state, hydrated: true } };
    case "error":
      return pushError(state, errorText(event.error));
    // ponytail: thread_changed/created/deleted are handled by the provider (it refreshes the
    // thread list + URL); the reducer leaves WorkbenchState.threads alone here. Every other
    // Native event variants below this projection's surface are ignored.
    default:
      return state;
  }
}

// --- Messages + tools -------------------------------------------------------------------------

function applyMessage(
  state: WorkbenchState,
  message: MastraDBMessage,
  status: WorkbenchMessage["status"],
): WorkbenchState {
  const messages = upsertMessage(state.transcript.messages, toWorkbenchMessage(message, status));
  const calls = foldTools(state.tools.calls, message);
  return {
    ...state,
    transcript: { ...state.transcript, messages, status: "loaded" },
    tools: {
      calls,
      activeToolCallIds: activeToolIds(calls),
      recentToolCallIds: recentToolIds(calls),
      rawIoAvailable: true,
    },
    inspector: {
      ...state.inspector,
      contextBreakdown: withMessagesSegment(state.inspector.contextBreakdown, messages),
    },
  };
}

function toWorkbenchMessage(
  message: MastraDBMessage,
  status: WorkbenchMessage["status"],
): WorkbenchMessage {
  return {
    id: message.id,
    role: message.role === "signal" ? "system" : message.role,
    parts: message.content.parts.flatMap(messagePart),
    status,
    createdAt: iso(message.createdAt),
    updatedAt: iso(message.createdAt),
  };
}

function messagePart(content: MastraMessagePart): WorkbenchMessagePart[] {
  switch (content.type) {
    case "text":
      return [{ kind: "text", text: content.text }];
    case "reasoning":
      return [{ kind: "reasoning", text: content.reasoning }];
    case "file": {
      const mime = content.mimeType;
      const url = imageSource(undefined, content.data, mime);
      if (!url) return [];
      if (mime && !mime.startsWith("image/")) return [{ kind: "text", text: "Attachment" }];
      return [{ kind: "image", url, mimeType: mime }];
    }
    case "tool-invocation": {
      const invocation = content.toolInvocation;
      const terminal =
        invocation.state === "result" ||
        invocation.state === "output-error" ||
        invocation.state === "output-denied";
      return [
        terminal
          ? {
              kind: "tool_result_ref",
              toolCallId: invocation.toolCallId,
              label: invocation.toolName,
            }
          : {
              kind: "tool_call_ref",
              toolCallId: invocation.toolCallId,
              label: invocation.toolName,
            },
      ];
    }
    case "data-signal":
    case "data-user-message": {
      const data = asRecord(content.data);
      const text = signalText(data.contents);
      if (!text) return [];
      return [
        data.tagName === "route-workspace"
          ? { kind: "text", text }
          : { kind: "status", text },
      ];
    }
    default:
      return [];
  }
}

/** Normalize a provider image part to a render-ready URL: pass through data:/http/blob, else
 * wrap raw base64 in a data URL. */
export function imageSource(
  direct: string | undefined,
  data: string | undefined,
  mime: string | undefined,
): string | undefined {
  if (direct && /^(data:|https?:|blob:)/.test(direct)) return direct;
  const raw = data ?? (direct && !direct.includes("/") ? direct : undefined);
  if (raw) return `data:${mime ?? "image/png"};base64,${raw}`;
  return direct;
}

function upsertMessage(messages: WorkbenchMessage[], next: WorkbenchMessage): WorkbenchMessage[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index >= 0) return messages.map((message, position) => (position === index ? next : message));
  // Reconcile the optimistic user echo: sendPrompt inserts a `local-user-*` turn immediately, then
  // the server streams the same turn back with ITS canonical id. Match the local twin by role+text
  // and adopt the server id IN PLACE — appending would render the user's message twice AND churn the
  // assistant-ui message array (id count changes under mounted rows). ponytail: text-equality twin
  // match; if a user ever sends two identical turns before the first echoes, worst case is one twin
  // collapse — replaced messages lose the `local-user-` prefix so the next echo finds the next twin.
  if (next.role === "user") {
    const twin = messages.findIndex(
      (message) =>
        message.id.startsWith("local-user-") &&
        message.role === "user" &&
        userText(message) === userText(next),
    );
    if (twin >= 0) return messages.map((message, position) => (position === twin ? next : message));
  }
  return [...messages, next];
}

/** Joined, trimmed text of a message's text parts — the key for optimistic-echo twin matching. */
function userText(message: WorkbenchMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/** Fold a native tool invocation part into the id-keyed tool collection. */
function foldTools(calls: WorkbenchToolCall[], message: MastraDBMessage): WorkbenchToolCall[] {
  let next = calls;
  for (const part of message.content.parts) {
    if (part.type !== "tool-invocation") continue;
    const invocation = part.toolInvocation;
    // Persisted parts BACKFILL the call — never clobber live tool_start/tool_end telemetry:
    // the message's createdAt stamps call and result identically (duration reads 0ms), and a
    // persisted part folding after tool_end must not downgrade live terminal telemetry.
    const existing = next.find((call) => call.id === invocation.toolCallId);
    const terminal =
      invocation.state === "result" ||
      invocation.state === "output-error" ||
      invocation.state === "output-denied";
    const failed = invocation.isError || invocation.state !== "result";
    next = upsertTool(next, invocation.toolCallId, {
      title: invocation.toolName,
      rawInput: invocation.rawInput ?? invocation.args,
      target: toolTargetHint(invocation.rawInput ?? invocation.args),
      status: terminal ? (failed ? "failed" : "completed") : "in_progress",
      parentMessageId: message.id,
      startedAt: existing?.startedAt ?? iso(message.createdAt),
      ...(terminal
        ? {
            rawOutput: invocation.result,
            completedAt: existing?.completedAt ?? iso(message.createdAt),
            ...(failed ? { error: invocation.errorText ?? stringify(invocation.result) } : {}),
          }
        : {}),
    });
  }
  return next;
}

function mergeTool(
  state: WorkbenchState,
  id: string,
  patch: Partial<WorkbenchToolCall>,
): WorkbenchState {
  const calls = upsertTool(state.tools.calls, id, patch);
  return {
    ...state,
    tools: {
      calls,
      activeToolCallIds: activeToolIds(calls),
      recentToolCallIds: recentToolIds(calls),
      rawIoAvailable: true,
    },
  };
}

function upsertTool(
  calls: WorkbenchToolCall[],
  id: string,
  patch: Partial<WorkbenchToolCall>,
): WorkbenchToolCall[] {
  const index = calls.findIndex((call) => call.id === id);
  if (index < 0) {
    return [...calls, { id, title: patch.title ?? id, ...patch, updatedAt: nowIso() }];
  }
  return calls.map((call, position) =>
    position === index ? { ...call, ...patch, id, updatedAt: nowIso() } : call,
  );
}

function collectTools(messages: MastraDBMessage[]): WorkbenchToolCall[] {
  let calls: WorkbenchToolCall[] = [];
  for (const message of messages) calls = foldTools(calls, message);
  return calls;
}

function activeToolIds(calls: WorkbenchToolCall[]): string[] {
  return calls
    .filter((call) => call.status !== "completed" && call.status !== "failed")
    .map((call) => call.id);
}

function recentToolIds(calls: WorkbenchToolCall[]): string[] {
  return calls
    .filter((call) => call.status === "completed" || call.status === "failed")
    .map((call) => call.id)
    .slice(-128);
}

// --- Approvals --------------------------------------------------------------------------------

interface PendingApprovalInput {
  requestId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  suspendPayload?: unknown;
}

function requestApproval(state: WorkbenchState, input: PendingApprovalInput): WorkbenchState {
  const request = {
    requestId: input.requestId,
    sessionId: state.agent.session?.sessionId ?? "",
    status: "pending" as const,
    toolCall: {
      id: input.toolCallId,
      title: input.toolName,
      status: "pending" as const,
      rawInput: input.args,
      ...(input.suspendPayload !== undefined ? { rawOutput: input.suspendPayload } : {}),
    },
    options: DEFAULT_APPROVAL_OPTIONS,
  };
  // The server's approval gate is single-slot and sequential: it arms the NEXT tool only after the
  // current one resolves. So any OTHER request still "pending" here is stale — its gate is already
  // gone, and approving it would silently no-op server-side. Supersede it so the one rendered card is
  // always the live gate.
  const superseded = state.approvals.requests.map((item) =>
    item.requestId !== request.requestId && item.status === "pending"
      ? { ...item, status: "canceled" as const }
      : item,
  );
  const index = superseded.findIndex((item) => item.requestId === request.requestId);
  const requests =
    index < 0
      ? [...superseded, request]
      : superseded.map((item, position) => (position === index ? request : item));
  return {
    ...state,
    approvals: { requests },
    uiStatus: { ...state.uiStatus, overall: { ...state.uiStatus.overall, status: "waiting" } },
  };
}

/** Once a tool completes, drop any pending approval that was gating it. */
function resolveApprovalsFor(state: WorkbenchState, toolCallId: string): WorkbenchState {
  if (!state.approvals.requests.some((request) => request.toolCall.id === toolCallId)) return state;
  const requests = state.approvals.requests.map((request) =>
    request.toolCall.id === toolCallId && request.status === "pending"
      ? { ...request, status: "resolved" as const }
      : request,
  );
  const stillWaiting = requests.some((request) => request.status === "pending");
  return {
    ...state,
    approvals: { requests },
    uiStatus: {
      ...state.uiStatus,
      overall: {
        ...state.uiStatus.overall,
        status:
          state.uiStatus.overall.status === "waiting" && !stillWaiting
            ? "running"
            : state.uiStatus.overall.status,
      },
    },
  };
}

// --- Run status -------------------------------------------------------------------------------

function withRunStatus(
  state: WorkbenchState,
  status: WorkbenchState["uiStatus"]["overall"]["status"],
): WorkbenchState {
  return {
    ...state,
    uiStatus: { ...state.uiStatus, overall: { ...state.uiStatus.overall, status } },
  };
}

function endRun(state: WorkbenchState): WorkbenchState {
  return {
    ...state,
    approvals: {
      requests: state.approvals.requests.map((request) =>
        request.status === "pending" ? { ...request, status: "canceled" as const } : request,
      ),
    },
    transcript: {
      ...state.transcript,
      messages: state.transcript.messages.map((message) =>
        message.status === "streaming" ? { ...message, status: "complete" } : message,
      ),
    },
    uiStatus: {
      ...state.uiStatus,
      overall: { ...state.uiStatus.overall, status: "idle", completedAt: nowIso() },
    },
  };
}

function endRunWithError(state: WorkbenchState, message: string): WorkbenchState {
  const ended = endRun(state);
  return pushError(ended, ended.uiStatus.errors.length > 0 ? undefined : message);
}

function pushError(state: WorkbenchState, message: string | undefined): WorkbenchState {
  const errors =
    message && !state.uiStatus.errors.includes(message)
      ? [...state.uiStatus.errors, message]
      : state.uiStatus.errors;
  return {
    ...state,
    uiStatus: {
      ...state.uiStatus,
      overall: { ...state.uiStatus.overall, status: "error" },
      errors,
    },
  };
}

// --- Plan / memory ----------------------------------------------------------------------------

function planEntries(tasks: AgentControllerTask[]): WorkbenchPlanEntry[] {
  return tasks.map((task) => ({
    id: task.id,
    content: task.content,
    status: task.status === "completed" || task.status === "in_progress" ? task.status : "pending",
  }));
}

function upsertMemory(
  state: WorkbenchState,
  entry: WorkbenchObservationMemoryEntry,
): WorkbenchState {
  const index = state.memory.entries.findIndex((item) => item.id === entry.id);
  const entries =
    index < 0
      ? [...state.memory.entries, entry]
      : state.memory.entries.map((item, position) => (position === index ? entry : item));
  return { ...state, memory: { entries } };
}

function configuredMemoryEntries(
  configured: Record<string, unknown> | undefined,
): WorkbenchObservationMemoryEntry[] {
  if (!configured || Object.keys(configured).length === 0) return [];
  // The /pe/inspect OM record is already shaped like a memory entry; pass it through.
  return [configured as unknown as WorkbenchObservationMemoryEntry];
}

// --- Context breakdown (ported from packages/runtime/src/context-breakdown.ts) ----------------

function buildBreakdown(
  inspect: PeInspect,
  messages: WorkbenchMessage[],
  omProgress: AgentControllerOMProgress | undefined,
): WorkbenchContextBreakdown | undefined {
  const systemPromptText = inspect.systemPrompt?.content;
  const tools = breakdownTools(inspect.toolList);
  const skills = breakdownSkills(inspect.skills);
  const hasInputs =
    systemPromptText !== undefined ||
    tools.length > 0 ||
    skills.length > 0 ||
    inspect.contextWindow !== undefined;
  if (!hasInputs) return undefined;

  const segments: WorkbenchContextSegment[] = [];
  const messageTokens = sumMessageTokens(messages);
  if (messageTokens > 0) segments.push(messagesSegment(messages.length, messageTokens));
  if (systemPromptText !== undefined) {
    segments.push({
      id: "system-prompt",
      label: "System prompt",
      tokens: estimateTokens(systemPromptText),
      items: systemPromptItems(systemPromptText, inspect.agents),
    });
  }
  if (tools.length > 0) {
    segments.push({
      id: "tools",
      label: "Tools & MCP",
      tokens: tools.reduce((sum, tool) => sum + tool.tokens, 0),
      items: tools.map((tool) => ({ ...tool, state: "in" })),
    });
  }
  if (skills.length > 0) {
    segments.push({
      id: "skills",
      label: "Skills",
      tokens: 0,
      items: skills,
    });
  }

  const totalTokens = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (inspect.contextWindow && inspect.contextWindow > totalTokens) {
    segments.push({ id: "free", label: "Free space", tokens: inspect.contextWindow - totalTokens });
  }

  return {
    contextWindow: inspect.contextWindow,
    totalTokens,
    segments,
    memoryWindows: omProgress ? memoryWindowsFromProgress(omProgress) : undefined,
    updatedAt: nowIso(),
  };
}

/** Recompute the volatile `messages` + `free` segments as the transcript streams. */
function withMessagesSegment(
  breakdown: WorkbenchContextBreakdown | undefined,
  messages: WorkbenchMessage[],
): WorkbenchContextBreakdown | undefined {
  if (!breakdown) return breakdown;
  const chat = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const tokens = sumMessageTokens(chat);
  const stable = breakdown.segments.filter((s) => s.id !== "messages" && s.id !== "free");
  const measured = tokens > 0 ? [messagesSegment(chat.length, tokens), ...stable] : stable;
  const totalTokens = measured.reduce((sum, segment) => sum + segment.tokens, 0);
  const segments =
    breakdown.contextWindow && breakdown.contextWindow > totalTokens
      ? [
          ...measured,
          { id: "free", label: "Free space", tokens: breakdown.contextWindow - totalTokens },
        ]
      : measured;
  return { ...breakdown, totalTokens, segments, updatedAt: nowIso() };
}

function messagesSegment(count: number, tokens: number): WorkbenchContextSegment {
  return {
    id: "messages",
    label: "Messages",
    tokens,
    items: [
      {
        name: `Conversation tail · ${count} msgs`,
        src: "transcript",
        tokens,
        state: "in",
        body: "The newest turn is always uncached — this tail is reprocessed every send.",
      },
    ],
  };
}

function systemPromptItems(text: string, agents: unknown[] | undefined): WorkbenchContextItem[] {
  const trimmed = text.trim();
  const items: WorkbenchContextItem[] = trimmed
    ? [
        {
          name: "Base identity",
          src: "resolved prompt",
          tokens: estimateTokens(trimmed),
          body: trimmed,
          state: "in",
        },
      ]
    : [];
  for (const agent of agents ?? []) {
    const record = asRecord(agent);
    const name = typeof agent === "string" ? agent : readString(record.name);
    if (!name) continue;
    items.push({
      name: `agent · ${name}`,
      src: "agent instructions",
      body: readString(record.description),
      state: "in",
    });
  }
  return items;
}

interface BreakdownToolItem extends WorkbenchContextItem {
  tokens: number;
}

function breakdownTools(toolList: PeInspect["toolList"]): BreakdownToolItem[] {
  return (toolList?.tools ?? []).flatMap((tool): BreakdownToolItem[] => {
    const record = asRecord(tool);
    const name = readString(record.name);
    if (!name) return [];
    const tokens = readNumber(record.approxTokens) ?? estimateTokens(name);
    return [{ name, src: "runtime/tools", tokens, body: readString(record.description) }];
  });
}

function breakdownSkills(skills: unknown[] | undefined): WorkbenchContextItem[] {
  return (skills ?? []).flatMap((skill): WorkbenchContextItem[] => {
    const record = asRecord(skill);
    const name = readString(record.name);
    if (!name) return [];
    return [
      {
        name,
        src: ".claude/skills",
        tokens: readNumber(record.approxTokens),
        body:
          readString(record.body) ?? readString(record.content) ?? readString(record.description),
        state: "on-demand",
      },
    ];
  });
}

function patchMemoryWindows(
  state: WorkbenchState,
  windows: WorkbenchMemoryWindows,
): WorkbenchState {
  const breakdown = state.inspector.contextBreakdown ?? { totalTokens: 0, segments: [] };
  return {
    ...state,
    inspector: {
      ...state.inspector,
      contextBreakdown: { ...breakdown, memoryWindows: windows },
    },
  };
}

function memoryWindowsFromProgress(om: AgentControllerOMProgress): WorkbenchMemoryWindows {
  return {
    messageTokens: om.pendingTokens ?? 0,
    observationThreshold: om.threshold ?? 0,
    observationTokens: om.observationTokens ?? 0,
    reflectionThreshold: om.reflectionThreshold ?? 0,
    observing: om.status === "observing",
    reflecting: om.status === "reflecting",
  };
}

function memoryWindowsFromStatus(windows: OmStatusWindows): WorkbenchMemoryWindows {
  const floor = windows.buffered.reflection.observationTokens;
  return {
    messageTokens: windows.active.messages.tokens,
    observationThreshold: windows.active.messages.threshold,
    observationTokens: windows.active.observations.tokens,
    reflectionThreshold: windows.active.observations.threshold,
    ...(floor > 0 ? { reflectionFloor: floor } : {}),
    observing: windows.buffered.observations.status === "running",
    reflecting: windows.buffered.reflection.status === "running",
  };
}

// --- Misc projection helpers ------------------------------------------------------------------

const ACCESS_LEVELS = [
  { id: "read-only" as const, name: "Read-only", description: "Block workspace changes." },
  { id: "ask" as const, name: "Ask", description: "Ask before tools that change state." },
  { id: "trusted" as const, name: "Trusted", description: "Run trusted workspace tools directly." },
];

const DEFAULT_APPROVAL_OPTIONS: WorkbenchApprovalOption[] = [
  { optionId: "allow_once", name: "Approve", kind: "allow_once" },
  { optionId: "reject_once", name: "Deny", kind: "reject_once" },
];

const PERMISSION_LEVELS = {
  "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
  ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
  trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
} as const;

export function accessLevelFromPermissions(
  rules: PermissionRules | undefined,
): WorkbenchAccessLevel {
  if (!rules) return "ask";
  const categories = rules.categories ?? {};
  return (
    (Object.entries(PERMISSION_LEVELS) as [WorkbenchAccessLevel, Record<string, string>][]).find(
      ([, expected]) =>
        Object.entries(expected).every(([category, policy]) => categories[category] === policy),
    )?.[0] ?? "read-only"
  );
}

function modelInfos(models: AgentControllerAvailableModel[]) {
  return models.map((model) => ({
    id: model.id,
    provider: model.provider,
    displayName: model.modelName,
    disabled: model.hasApiKey === false,
  }));
}

function skillCommands(skills: unknown[] | undefined) {
  return (skills ?? []).flatMap((skill) => {
    const record = asRecord(skill);
    const name = readString(record.name);
    return name ? [{ name, description: readString(record.description) ?? "skill" }] : [];
  });
}

function systemPromptSnapshot(systemPrompt: PeInspect["systemPrompt"]) {
  const content = systemPrompt?.content;
  if (!content) return undefined;
  return { content, source: systemPrompt?.source, updatedAt: systemPrompt?.updatedAt };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  return readString(record.message) ?? (stringify(error) || "Unknown error.");
}

function toolTargetHint(args: unknown): string | undefined {
  const record = asRecord(args);
  const candidate = record.path ?? record.file ?? record.query ?? record.command;
  if (typeof candidate === "string") return candidate;
  if (typeof args === "string" && args.length <= 64) return args;
  return undefined;
}

function sumMessageTokens(messages: WorkbenchMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(messageText(message)), 0);
}

function messageText(message: WorkbenchMessage): string {
  return message.parts
    .map((part) =>
      part.kind === "text" || part.kind === "reasoning" || part.kind === "thought" ? part.text : "",
    )
    .join("\n");
}

/** char/4 token estimate — good enough for the inspector's relative proportions. */
export function estimateTokens(text: string | undefined): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

function iso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function signalText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => readString(asRecord(part).text) ?? "")
    .filter(Boolean)
    .join("\n");
}
