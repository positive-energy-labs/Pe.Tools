import { expect, test } from "vite-plus/test";
import { createWorkbenchState } from "@pe/agent-contracts";
import { applyWireEvent, hydrateWorkbenchState } from "./adapter.ts";
import type { WireEvent, WireMessage } from "./wire.ts";

function reduce(events: WireEvent[]) {
  return events.reduce(applyWireEvent, createWorkbenchState());
}

test("message_start → update → end yields one complete assistant message", () => {
  const id = "m1";
  const message = (text: string): WireMessage => ({
    id,
    role: "assistant",
    content: [{ type: "text", text }],
  });
  const state = reduce([
    { type: "agent_start" },
    { type: "message_start", message: message("He") },
    { type: "message_update", message: message("Hello") },
    { type: "message_end", message: message("Hello world") },
    { type: "agent_end", reason: "complete" },
  ]);

  expect(state.transcript.messages.length).toBe(1);
  const only = state.transcript.messages[0]!;
  expect(only.id).toBe(id);
  expect(only.role).toBe("assistant");
  expect(only.status).toBe("complete");
  expect(only.parts).toEqual([{ kind: "text", text: "Hello world" }]);
  expect(state.uiStatus.overall.status).toBe("idle");
});

test("tool_start → tool_end yields a completed tool call carrying raw I/O", () => {
  const state = reduce([
    { type: "agent_start" },
    { type: "tool_start", toolCallId: "t1", toolName: "read_file", args: { path: "a.ts" } },
    { type: "tool_end", toolCallId: "t1", result: "file body", isError: false },
  ]);

  expect(state.tools.calls.length).toBe(1);
  const call = state.tools.calls[0]!;
  expect(call.id).toBe("t1");
  expect(call.title).toBe("read_file");
  expect(call.status).toBe("completed");
  expect(call.rawInput).toEqual({ path: "a.ts" });
  expect(call.rawOutput).toBe("file body");
  expect(call.target).toBe("a.ts");
  expect(state.tools.activeToolCallIds).toEqual([]);
  expect(state.tools.recentToolCallIds).toEqual(["t1"]);
});

test("state_changed replaces the live route-state map", () => {
  const first = reduce([{ type: "state_changed", state: { "route:family-types": { cells: {} } } }]);
  const second = applyWireEvent(first, {
    type: "state_changed",
    state: { "route:parameter-links": { draftProfile: null } },
  });

  expect(second.sessionState.values).toEqual({
    "route:parameter-links": { draftProfile: null },
  });
});

test("a second approval supersedes the first still-pending one (single-slot server gate)", () => {
  const state = reduce([
    { type: "agent_start" },
    { type: "tool_approval_required", toolCallId: "a", toolName: "request_access", args: {} },
    { type: "tool_approval_required", toolCallId: "b", toolName: "write_file", args: {} },
  ]);
  const byId = (id: string) =>
    state.approvals.requests.find((r) => r.requestId === `tool-approval:${id}`);
  expect(byId("a")?.status).toBe("canceled");
  expect(byId("b")?.status).toBe("pending");
});

test("tool_approval_required gates the run; tool_end clears it", () => {
  const pending = reduce([
    { type: "agent_start" },
    { type: "tool_approval_required", toolCallId: "t2", toolName: "write_file", args: {} },
  ]);
  expect(pending.uiStatus.overall.status).toBe("waiting");
  expect(pending.approvals.requests[0]?.requestId).toBe("tool-approval:t2");
  expect(pending.approvals.requests[0]?.status).toBe("pending");

  const resolved = applyWireEvent(pending, {
    type: "tool_end",
    toolCallId: "t2",
    result: "ok",
    isError: false,
  });
  expect(resolved.approvals.requests[0]?.status).toBe("resolved");
  expect(resolved.uiStatus.overall.status).toBe("running");
});

test("a suspended agent_end keeps the pending approval (does NOT end the run)", () => {
  // request_access suspends the run for HITL. The server then emits agent_end(reason:"suspended");
  // that must NOT cancel the approval or flip to idle — else the approve/deny buttons vanish AND the
  // provider's re-hydrate replays the still-active run in a loop.
  const state = reduce([
    { type: "agent_start" },
    {
      type: "tool_suspended",
      toolCallId: "t9",
      toolName: "request_access",
      args: {},
      suspendPayload: {},
    },
    { type: "agent_end", reason: "suspended" },
  ]);
  expect(state.approvals.requests[0]?.status).toBe("pending");
  expect(state.approvals.requests[0]?.requestId).toBe("tool-suspended:t9");
  expect(state.uiStatus.overall.status).toBe("waiting");
});

test("a live approval survives a stray agent_end(aborted) from a redundant thread switch", () => {
  // 1.50's session.thread.switch() aborts the active run before rebinding — even switching to the
  // thread we're already on — so a redundant hydrate emits agent_end(aborted) over a run the UI is
  // still gating. The reducer must NOT let that cancel the pending approval (buttons would vanish).
  const state = reduce([
    { type: "agent_start" },
    { type: "tool_approval_required", toolCallId: "t7", toolName: "write_file", args: {} },
    { type: "agent_end", reason: "aborted" },
  ]);
  expect(state.approvals.requests[0]?.status).toBe("pending");
  expect(state.approvals.requests[0]?.requestId).toBe("tool-approval:t7");
  expect(state.uiStatus.overall.status).toBe("waiting");
});

test("approval survives a duplicate replay of the whole suspend sequence, then resolves", () => {
  // The full lifecycle the owner hits: tool call → suspension → the run gets replayed (a duplicate
  // agent_start + tool_suspended arrives over a reconnected/rebound stream) → the user finally
  // approves and the tool completes. Through all of it the approval UI state must stay coherent:
  // exactly one pending request while suspended, then resolved once tool_end lands.
  const suspend: WireEvent = {
    type: "tool_suspended",
    toolCallId: "t9",
    toolName: "request_access",
    args: { path: "/tmp" },
    suspendPayload: { options: ["Approve"] },
  };
  const suspended = reduce([
    { type: "agent_start" },
    suspend,
    { type: "agent_end", reason: "suspended" },
    // --- duplicate replay of the same run (no markers distinguishing it from live) ---
    { type: "agent_start" },
    suspend,
    { type: "agent_end", reason: "suspended" },
  ]);
  // Exactly one pending approval survives — the replay is idempotent, not additive.
  expect(suspended.approvals.requests.length).toBe(1);
  expect(suspended.approvals.requests[0]?.status).toBe("pending");
  expect(suspended.uiStatus.overall.status).toBe("waiting");

  // The user approves; the resumed tool completes.
  const resolved = applyWireEvent(suspended, {
    type: "tool_end",
    toolCallId: "t9",
    result: "Access granted.",
    isError: false,
  });
  expect(resolved.approvals.requests[0]?.status).toBe("resolved");
  expect(resolved.uiStatus.overall.status).toBe("running");
});

test("the optimistic user echo reconciles in place — no duplicate turn", () => {
  // sendPrompt inserts a `local-user-*` turn, then the server streams the same turn back with its
  // own id. The reducer must adopt the server id in place, not append a second "you" bubble.
  const state = reduce([
    { type: "agent_start" },
    {
      type: "message_start",
      message: { id: "local-user-123", role: "user", content: [{ type: "text", text: "hi" }] },
    },
    {
      type: "message_start",
      message: { id: "server-abc", role: "user", content: [{ type: "text", text: "hi" }] },
    },
  ]);
  const users = state.transcript.messages.filter((m) => m.role === "user");
  expect(users.length).toBe(1);
  expect(users[0]?.id).toBe("server-abc");
});

test("run errors surface message error text", () => {
  const state = reduce([
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        id: "a1",
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "The model stopped on a content filter.",
      },
    },
    { type: "agent_end", reason: "error" },
  ]);

  expect(state.transcript.messages[0]?.status).toBe("error");
  expect(state.uiStatus.overall.status).toBe("error");
  expect(state.uiStatus.errors).toEqual(["The model stopped on a content filter."]);
});

test("hydrate projects messages, tools, models and inspector from REST snapshots", () => {
  const state = hydrateWorkbenchState({
    controllerId: "pea",
    resourceId: "res",
    threadId: "thread-1",
    displayState: {
      controllerId: "pea",
      resourceId: "res",
      modeId: "build",
      modelId: "anthropic/x",
      settings: { yolo: true, thinkingLevel: "off", notifications: "off", smartEditing: false },
    },
    threads: [{ id: "thread-1", title: "First" }],
    messages: [
      { id: "u1", role: "user", content: [{ type: "text", text: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool_call", id: "tc1", name: "grep", args: { query: "foo" } },
          { type: "tool_result", id: "tc1", name: "grep", result: "match", isError: false },
        ],
      },
    ],
    inspect: {
      systemPrompt: { content: "You are Pea.", source: "resolved" },
      toolList: { tools: [{ name: "grep", approxTokens: 20 }] },
      contextWindow: 1000,
    },
    models: [
      { id: "anthropic/x", provider: "anthropic", modelName: "X", hasApiKey: true, useCount: 0 },
    ],
    modes: [{ id: "build", name: "Build" }],
  });

  expect(state.transcript.messages.length).toBe(2);
  expect(state.tools.calls[0]?.id).toBe("tc1");
  expect(state.tools.calls[0]?.status).toBe("completed");
  expect(state.tools.calls[0]?.parentMessageId).toBe("a1");
  expect(state.models.currentModelId).toBe("anthropic/x");
  expect(state.modes.currentModeId).toBe("build");
  expect(state.access.currentAccessLevel).toBe("trusted");
  expect(state.threads.activeThreadId).toBe("thread-1");
  expect(state.inspector.systemPrompt?.content).toBe("You are Pea.");
  const byId = Object.fromEntries(
    (state.inspector.contextBreakdown?.segments ?? []).map((s) => [s.id, s]),
  );
  expect(byId["system-prompt"]?.tokens).toBe(3); // "You are Pea." = 12 chars / 4
  expect(byId.tools?.tokens).toBe(20);
});
