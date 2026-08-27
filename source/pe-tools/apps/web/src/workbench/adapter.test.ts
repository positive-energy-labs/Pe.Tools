import { expect, test } from "vite-plus/test";
import { createWorkbenchState } from "@pe/agent-contracts";
import type { KnownAgentControllerEvent, MastraDBMessage, MastraMessagePart } from "@mastra/client-js";
import { applyAgentControllerEvent, hydrateWorkbenchState } from "./adapter.ts";

function reduce(events: KnownAgentControllerEvent[]) {
  return events.reduce(applyAgentControllerEvent, createWorkbenchState());
}

function message(
  id: string,
  role: MastraDBMessage["role"],
  parts: MastraMessagePart[],
): MastraDBMessage {
  return { id, role, createdAt: new Date(), content: { format: 2, parts } };
}

test("message_start → update → end yields one complete assistant message", () => {
  const id = "m1";
  const assistant = (text: string) => message(id, "assistant", [{ type: "text", text }]);
  const state = reduce([
    { type: "agent_start" },
    { type: "message_start", message: assistant("He") },
    { type: "message_update", message: assistant("Hello") },
    { type: "message_end", message: assistant("Hello world") },
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
  const first = reduce([
    {
      type: "state_changed",
      state: { "route:family-types": { cells: {} } },
      changedKeys: ["route:family-types"],
    },
  ]);
  const second = applyAgentControllerEvent(first, {
    type: "state_changed",
    state: { "route:parameter-links": { draftProfile: null } },
    changedKeys: ["route:parameter-links"],
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

  const resolved = applyAgentControllerEvent(pending, {
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

test("the optimistic user echo reconciles in place — no duplicate turn", () => {
  // sendPrompt inserts a `local-user-*` turn, then the server streams the same turn back with its
  // own id. The reducer must adopt the server id in place, not append a second "you" bubble.
  const state = reduce([
    { type: "agent_start" },
    {
      type: "message_start",
      message: message("local-user-123", "user", [{ type: "text", text: "hi" }]),
    },
    {
      type: "message_start",
      message: message("server-abc", "user", [{ type: "text", text: "hi" }]),
    },
  ]);
  const users = state.transcript.messages.filter((m) => m.role === "user");
  expect(users.length).toBe(1);
  expect(users[0]?.id).toBe("server-abc");
});

test("a terminal stream error ends projected running state", () => {
  const state = reduce([
    { type: "agent_start" },
    {
      type: "tool_suspended",
      toolCallId: "t-error",
      toolName: "request_access",
      args: {},
      suspendPayload: {},
    },
    { type: "agent_end", reason: "error" },
  ]);

  expect(state.uiStatus.overall.status).toBe("error");
  expect(state.uiStatus.errors).toEqual(["Run failed."]);
  expect(state.approvals.requests[0]?.status).toBe("canceled");
});

test("a provider error remains authoritative through terminal agent_end", () => {
  const state = reduce([
    { type: "agent_start" },
    { type: "error", error: new Error("Provider quota exhausted.") },
    { type: "agent_end", reason: "error" },
  ]);

  expect(state.uiStatus.errors).toEqual(["Provider quota exhausted."]);
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
      settings: { yolo: false, thinkingLevel: "off", notifications: "off", smartEditing: false },
    },
    threads: [{ id: "thread-1", title: "First" }],
    messages: [
      message("u1", "user", [{ type: "text", text: "hi" }]),
      message("a1", "assistant", [
          { type: "text", text: "calling" },
          {
            type: "tool-invocation",
            toolInvocation: {
              state: "result",
              toolCallId: "tc1",
              toolName: "grep",
              args: { query: "foo" },
              result: "match",
            },
          },
        ]),
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
    permissions: {
      categories: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
      tools: {},
    },
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

test("persisted message parts backfill a tool call without clobbering live telemetry", async () => {
  const live = reduce([
    { type: "agent_start" },
    { type: "tool_start", toolCallId: "t1", toolName: "script_execute", args: { code: "x" } },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const done = applyAgentControllerEvent(live, {
    type: "tool_end",
    toolCallId: "t1",
    result: "ok",
    isError: false,
  });
  const stamped = done.tools.calls[0]!;
  expect(Date.parse(stamped.completedAt!)).toBeGreaterThan(Date.parse(stamped.startedAt!));

  // The persisted assistant message refolds tool_call + tool_result with ONE createdAt — it must
  // not overwrite the live timestamps (duration would read 0ms) nor downgrade the terminal status.
  const refolded = applyAgentControllerEvent(done, {
    type: "message_end",
    message: message("m1", "assistant", [
      {
        type: "tool-invocation",
        toolInvocation: {
          state: "result",
          toolCallId: "t1",
          toolName: "script_execute",
          args: { code: "x" },
          result: "ok",
        },
      },
    ]),
  });
  const call = refolded.tools.calls[0]!;
  expect(call.status).toBe("completed");
  expect(call.startedAt).toBe(stamped.startedAt);
  expect(call.completedAt).toBe(stamped.completedAt);
});

test("route workspace signals remain visible human chronology", () => {
  const state = hydrateWorkbenchState({
    controllerId: "pea",
    resourceId: "res",
    threadId: "thread-1",
    threads: [],
    messages: [
      message("review-1", "signal", [
        {
          type: "data-signal",
          data: {
            id: "signal-1",
            type: "state",
            tagName: "route-workspace",
            contents: "Human review edit on family-types succeeded.",
            createdAt: new Date().toISOString(),
          },
        },
      ]),
    ],
    inspect: {},
    models: [],
    modes: [],
  });

  expect(state.transcript.messages[0]?.parts).toEqual([
    { kind: "text", text: "Human review edit on family-types succeeded." },
  ]);
});
