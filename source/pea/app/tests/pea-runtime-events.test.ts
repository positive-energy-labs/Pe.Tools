import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HarnessEvent, HarnessMessage } from "@mastra/core/harness";
import { MastraHarnessToPeaRuntimeEvents } from "../mastra-harness-runtime-events.js";
import { sanitizeJson } from "../pea-runtime-events.js";

describe("Pea runtime events", () => {
  it("maps Mastra assistant message updates into Pea text deltas", () => {
    const mapper = new MastraHarnessToPeaRuntimeEvents();

    const first = mapper.translate(messageEvent("Hello"));
    const second = mapper.translate(messageEvent("Hello there"));

    assert.deepEqual(first, [
      { type: "assistant_message_started", messageId: "message-1" },
      { type: "assistant_message_delta", messageId: "message-1", delta: "Hello" },
    ]);
    assert.deepEqual(second, [
      { type: "assistant_message_delta", messageId: "message-1", delta: " there" },
    ]);
  });

  it("maps Mastra tool lifecycle into Pea tool events with sanitized payloads", () => {
    const mapper = new MastraHarnessToPeaRuntimeEvents();

    const events = [
      ...mapper.translate({
        type: "tool_start",
        toolCallId: "tool-1",
        toolName: "execute_command",
        args: { command: "pnpm test", at: new Date("2026-06-08T00:00:00.000Z") },
      } as HarnessEvent),
      ...mapper.translate({
        type: "shell_output",
        toolCallId: "tool-1",
        output: "ok\n",
        stream: "stdout",
      } as HarnessEvent),
      ...mapper.translate({
        type: "tool_end",
        toolCallId: "tool-1",
        result: { exitCode: 0 },
        isError: false,
      } as HarnessEvent),
    ];

    assert.deepEqual(events, [
      {
        type: "tool_started",
        toolCallId: "tool-1",
        toolName: "execute_command",
        status: "running",
        input: { command: "pnpm test", at: "2026-06-08T00:00:00.000Z" },
      },
      { type: "tool_shell_output", toolCallId: "tool-1", output: "ok\n", stream: "stdout" },
      {
        type: "tool_finished",
        toolCallId: "tool-1",
        toolName: "execute_command",
        result: { exitCode: 0 },
        isError: false,
      },
    ]);
  });

  it("normalizes Mastra subagent inner tools into regular Pea tool events", () => {
    const mapper = new MastraHarnessToPeaRuntimeEvents();

    const [start] = mapper.translate({
      type: "subagent_tool_start",
      toolCallId: "parent-1",
      agentType: "explore",
      subToolName: "search_content",
      subToolArgs: { pattern: "ACP" },
    } as unknown as HarnessEvent);

    assert.deepEqual(start, {
      type: "tool_started",
      toolCallId: "subagent:parent-1:search_content",
      toolName: "search_content",
      title: "subagent: explore -> search_content",
      status: "running",
      input: { pattern: "ACP" },
    });
  });

  it("sanitizes circular values without throwing", () => {
    const circular: { name: string; self?: unknown } = { name: "root" };
    circular.self = circular;

    assert.deepEqual(sanitizeJson(circular), { name: "root", self: "[Circular]" });
  });
});

function messageEvent(text: string): HarnessEvent {
  return {
    type: "message_update",
    message: {
      id: "message-1",
      role: "assistant",
      content: [{ type: "text", text }],
      createdAt: new Date("2026-06-08T00:00:00.000Z"),
    } as HarnessMessage,
  } as HarnessEvent;
}
