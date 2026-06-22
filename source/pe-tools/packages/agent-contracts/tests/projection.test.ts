import { peWorkbenchUpdateMetadataKey, type WorkbenchEvent } from "../src/index.ts";
import { expect, test } from "vite-plus/test";
import {
  acpSessionUpdateToWorkbenchEvents,
  applyWorkbenchEvent,
  createWorkbenchState,
  selectActiveThread,
  selectActiveThreadId,
  selectActiveToolCalls,
  selectCurrentModeLabel,
  selectCurrentModelLabel,
  selectPendingApprovals,
  selectRecentCompletedToolCalls,
  selectVisibleThreads,
  selectVisibleTranscriptMessages,
} from "../src/index.ts";

test("projects user, assistant, and thought chunks into a part-based transcript", () => {
  const state = applyAll(createWorkbenchState(), [
    ...acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "user_message_chunk",
      messageId: "user-1",
      content: { type: "text", text: "Hello" },
    }),
    ...acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-1",
      content: { type: "text", text: "Thinking" },
    }),
    ...acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "agent_message_chunk",
      messageId: "assistant-1",
      content: { type: "text", text: "Done" },
    }),
  ]);

  expect(selectVisibleTranscriptMessages(state)).toEqual([
    expect.objectContaining({
      id: "user-1",
      role: "user",
      parts: [expect.objectContaining({ kind: "text", text: "Hello" })],
    }),
    expect.objectContaining({
      id: "thought-1",
      role: "thought",
      parts: [expect.objectContaining({ kind: "thought", text: "Thinking" })],
    }),
    expect.objectContaining({
      id: "assistant-1",
      role: "assistant",
      parts: [expect.objectContaining({ kind: "text", text: "Done" })],
    }),
  ]);
  expect(state.debug.events.map((event) => event.type)).toEqual([
    "user_message_chunk",
    "agent_thought_chunk",
    "agent_message_chunk",
  ]);
});

test("retains active and recent tool calls with raw IO, timeline, concise transcript references, and debug events", () => {
  let state = createWorkbenchState();

  state = applyAll(state, [
    { type: "run_status_changed", status: "running", timestamp: "2026-06-11T10:00:00.000Z" },
    ...acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read file",
      status: "in_progress",
      rawInput: { path: "source/app.ts" },
      content: [{ type: "content", content: { type: "text", text: "Reading source/app.ts" } }],
    }),
  ]);

  expect(selectActiveToolCalls(state)).toEqual([
    expect.objectContaining({
      id: "tool-1",
      status: "in_progress",
      rawInput: { path: "source/app.ts" },
    }),
  ]);
  expect(state.tools.rawIoAvailable).toBe(true);

  state = applyAll(state, [
    ...acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      title: "Read file",
      status: "completed",
      rawOutput: { lineCount: 42 },
      content: [{ type: "content", content: { type: "text", text: "42 lines" } }],
    }),
    { type: "run_status_changed", status: "idle", timestamp: "2026-06-11T10:00:05.000Z" },
  ]);

  expect(state.uiStatus.overall).toEqual({
    status: "idle",
    startedAt: "2026-06-11T10:00:00.000Z",
    completedAt: "2026-06-11T10:00:05.000Z",
  });
  expect(selectActiveToolCalls(state)).toEqual([]);
  expect(selectRecentCompletedToolCalls(state)).toEqual([
    expect.objectContaining({
      id: "tool-1",
      status: "completed",
      rawInput: { path: "source/app.ts" },
      rawOutput: { lineCount: 42 },
      content: "42 lines",
      timeline: expect.arrayContaining([
        expect.objectContaining({ status: "in_progress", summary: "Reading source/app.ts" }),
        expect.objectContaining({ status: "completed", summary: "42 lines" }),
      ]),
    }),
  ]);
  expect(selectVisibleTranscriptMessages(state).at(-1)).toEqual(
    expect.objectContaining({
      id: "session-1:tools",
      role: "tool",
      parts: [expect.objectContaining({ kind: "tool_call_ref", toolCallId: "tool-1" })],
    }),
  );
  expect(state.debug.events.map((event) => event.type)).toEqual(["tool_call", "tool_call_update"]);
});

test("tracks failed tool calls as recent failures", () => {
  const state = applyAll(
    createWorkbenchState(),
    acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-2",
      title: "Write file",
      status: "failed",
      rawOutput: { error: "denied" },
      content: [{ type: "content", content: { type: "text", text: "Access denied" } }],
    }),
  );

  expect(selectRecentCompletedToolCalls(state)).toEqual([
    expect.objectContaining({ id: "tool-2", status: "failed", content: "Access denied" }),
  ]);
});

test("models approval request and resolution lifecycle", () => {
  const toolCall = { id: "tool-1", title: "Edit file", status: "in_progress" } as const;
  const pending = applyWorkbenchEvent(createWorkbenchState(), {
    type: "approval_requested",
    approval: {
      requestId: "approval-1",
      sessionId: "session-1",
      toolCall,
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
      status: "pending",
      defaultOptionId: "deny",
    },
  });

  expect(selectPendingApprovals(pending)).toHaveLength(1);
  expect(pending.uiStatus.overall.status).toBe("waiting");

  const resolved = applyWorkbenchEvent(pending, {
    type: "approval_resolved",
    requestId: "approval-1",
    resolution: { optionId: "allow", kind: "allow_once", resolvedAt: "2026-06-11T10:00:00.000Z" },
  });

  expect(selectPendingApprovals(resolved)).toEqual([]);
  expect(resolved.approvals.requests[0]).toEqual(
    expect.objectContaining({
      requestId: "approval-1",
      status: "resolved",
      resolution: expect.objectContaining({ optionId: "allow" }),
    }),
  );
});

test("loading a thread replaces transcript and updates active thread deterministically", () => {
  const state = applyAll(createWorkbenchState(), [
    {
      type: "threads_replaced",
      threads: [
        { threadId: "thread-1", title: "One" },
        { threadId: "thread-2", title: "Two" },
      ],
      activeThreadId: "thread-1",
    },
    {
      type: "session_started",
      session: { sessionId: "thread-2", cwd: "C:/repo", additionalDirectories: [] },
      thread: { threadId: "thread-2", title: "Two" },
    },
    {
      type: "transcript_replaced",
      messages: [
        {
          id: "loaded-1",
          role: "assistant",
          parts: [{ kind: "text", text: "Loaded" }],
          status: "complete",
        },
      ],
    },
  ]);

  expect(selectActiveThread(state)).toEqual(expect.objectContaining({ threadId: "thread-2" }));
  expect(state.agent.session?.sessionId).toBe("thread-2");
  expect(selectVisibleTranscriptMessages(state)).toEqual([
    expect.objectContaining({ id: "loaded-1" }),
  ]);
  expect(state.inspector.rawMessages).toEqual([
    expect.objectContaining({ id: "raw-message:loaded-1", title: "1. assistant" }),
  ]);
});

test("visible thread selectors dedupe the current materialized session and resolve active id", () => {
  const state = applyAll(createWorkbenchState(), [
    {
      type: "session_started",
      session: {
        sessionId: "session-current",
        cwd: "C:/repo",
        additionalDirectories: [],
        title: "Current",
      },
    },
    {
      type: "threads_replaced",
      threads: [
        { threadId: "session-current", sessionId: "session-current", title: "Draft Current" },
        { threadId: "thread-current", sessionId: "session-current", title: "Current" },
        { threadId: "thread-other", title: "Other" },
      ],
      activeThreadId: "session-current",
    },
  ]);

  expect(selectVisibleThreads(state).map((thread) => thread.threadId)).toEqual([
    "thread-current",
    "thread-other",
  ]);
  expect(selectActiveThreadId(state)).toBe("thread-current");
  expect(selectActiveThread(state)).toEqual(
    expect.objectContaining({ threadId: "thread-current" }),
  );
});

test("projects ACP side-channel metadata into memory, inspector, model, mode, and threads", () => {
  const events = acpSessionUpdateToWorkbenchEvents("session-1", {
    sessionUpdate: "agent_message_chunk",
    messageId: "assistant-1",
    content: { type: "text", text: "Done" },
    _meta: {
      [peWorkbenchUpdateMetadataKey]: {
        observationalMemory: {
          id: "om-1",
          kind: "observation",
          status: "complete",
          summary: "Kept useful UI state facts.",
          observedTokens: 123,
          compressionRatio: 0.42,
        },
        systemPrompt: {
          content: "You are Pea.",
          source: "runtime",
          updatedAt: "2026-06-11T11:00:00.000Z",
        },
        contextEntries: [{ id: "context-1", title: "Startup", content: { cwd: "C:/repo" } }],
        rawMessages: [{ id: "raw-1", title: "Assistant", content: { role: "assistant" } }],
        model: {
          currentModelId: "openai/gpt-5.5",
          availableModels: [{ id: "openai/gpt-5.5", provider: "openai", displayName: "GPT 5.5" }],
          recentModelIds: ["openai/gpt-5.5"],
        },
        mode: {
          currentModeId: "agent",
          availableModes: [{ id: "agent", name: "Agent" }],
        },
        access: {
          currentAccessLevel: "trusted",
          availableAccessLevels: [{ id: "trusted", name: "Trusted" }],
        },
        threads: [{ threadId: "thread-1", title: "Main thread" }],
        activeThreadId: "thread-1",
      },
    },
  });

  const state = applyAll(createWorkbenchState(), events);

  expect(selectVisibleTranscriptMessages(state)[0]).toEqual(
    expect.objectContaining({
      id: "assistant-1",
      role: "assistant",
      parts: [expect.objectContaining({ kind: "text", text: "Done" })],
    }),
  );
  expect(state.memory.entries).toEqual([
    expect.objectContaining({
      id: "om-1",
      kind: "observation",
      status: "complete",
      observedTokens: 123,
    }),
  ]);
  expect(state.inspector.systemPrompt).toEqual(
    expect.objectContaining({ content: "You are Pea.", source: "runtime" }),
  );
  expect(state.inspector.contextEntries).toHaveLength(1);
  expect(state.inspector.rawMessages).toHaveLength(1);
  expect(selectCurrentModelLabel(state)).toBe("GPT 5.5");
  expect(selectCurrentModeLabel(state)).toBe("Agent");
  expect(state.access.currentAccessLevel).toBe("trusted");
  expect(state.access.availableAccessLevels).toEqual([
    expect.objectContaining({ id: "trusted", name: "Trusted" }),
  ]);
  expect(state.threads.items).toEqual([expect.objectContaining({ threadId: "thread-1" })]);
  expect(state.threads.activeThreadId).toBe("thread-1");
});

test("keeps ACP session mode separate from model selection", () => {
  const state = applyAll(
    createWorkbenchState(),
    acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "current_mode_update",
      currentModeId: "agent",
    }),
  );

  expect(state.modes).toEqual({ currentModeId: "agent", availableModes: [] });
  expect(state.models.currentModelId).toBeUndefined();
});

test("records unknown ACP updates as debug-only events without corrupting state", () => {
  const state = applyAll(
    createWorkbenchState(),
    acpSessionUpdateToWorkbenchEvents("session-1", {
      sessionUpdate: "status_changed",
      status: "thinking",
    }),
  );

  expect(state.uiStatus.overall.status).toBe("idle");
  expect(state.debug.events).toEqual([expect.objectContaining({ type: "status_changed" })]);
});

test("caps retained debug events for long-running UI sessions", () => {
  const state = Array.from(
    { length: 505 },
    (_, index): WorkbenchEvent => ({
      type: "debug_event_recorded",
      debugEvent: {
        id: `debug-${index}`,
        source: "workbench",
        type: "test",
      },
    }),
  ).reduce(applyWorkbenchEvent, createWorkbenchState());

  expect(state.debug.events).toHaveLength(500);
  expect(state.debug.events[0]?.id).toBe("debug-5");
  expect(state.debug.events.at(-1)?.id).toBe("debug-504");
});

function applyAll(state: ReturnType<typeof createWorkbenchState>, events: WorkbenchEvent[]) {
  return events.reduce(applyWorkbenchEvent, state);
}
