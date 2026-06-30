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
