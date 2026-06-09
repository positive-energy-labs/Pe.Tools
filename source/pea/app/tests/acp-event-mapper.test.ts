import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PeaRuntimeToAcpEvents } from "../acp/pea-runtime-to-acp-events.js";
import type { PeaRuntimeEvent } from "../pea-runtime-events.js";

describe("ACP event mapper", () => {
  it("maps tool start raw args to ACP rawInput", () => {
    const mapper = new PeaRuntimeToAcpEvents();

    const [update] = mapper.translate({
      type: "tool_started",
      toolCallId: "tool-1",
      toolName: "execute_command",
      status: "running",
      input: { command: "pnpm test", cwd: "source/pea/app" },
    });

    assert.equal(update?.sessionUpdate, "tool_call");
    assert.equal(update.toolCallId, "tool-1");
    assert.equal(update.kind, "execute");
    assert.equal(update.status, "in_progress");
    assert.deepEqual(update.rawInput, { command: "pnpm test", cwd: "source/pea/app" });
  });

  it("maps tool completion raw result to ACP rawOutput", () => {
    const mapper = new PeaRuntimeToAcpEvents();
    mapper.translate({
      type: "tool_started",
      toolCallId: "tool-2",
      toolName: "view",
      status: "running",
      input: { path: "main.ts" },
    });

    const [update] = mapper.translate({
      type: "tool_finished",
      toolCallId: "tool-2",
      result: { content: "file text" },
      isError: false,
    });

    assert.equal(update?.sessionUpdate, "tool_call_update");
    assert.equal(update.toolCallId, "tool-2");
    assert.equal(update.kind, "read");
    assert.equal(update.status, "completed");
    assert.deepEqual(update.rawOutput, { content: "file text" });
  });

  it("maps errors to failed ACP tool updates", () => {
    const mapper = new PeaRuntimeToAcpEvents();

    mapper.translate({
      type: "tool_started",
      toolCallId: "tool-3",
      toolName: "write_file",
      status: "running",
      input: { path: "out.txt" },
    });

    const [update] = mapper.translate({
      type: "tool_finished",
      toolCallId: "tool-3",
      result: { name: "Error", message: "denied" },
      isError: true,
    });

    assert.equal(update?.sessionUpdate, "tool_call_update");
    assert.equal(update.status, "failed");
    assert.deepEqual(update.rawOutput, { name: "Error", message: "denied" });
  });

  it("maps task state to an ACP plan", () => {
    const mapper = new PeaRuntimeToAcpEvents();

    const [update] = mapper.translate({
      type: "plan_updated",
      tasks: [
        {
          id: "inspect",
          content: "Inspect code",
          status: "completed",
          activeForm: "Inspecting code",
        },
        { id: "test", content: "Run tests", status: "in_progress", activeForm: "Running tests" },
      ],
    });

    assert.equal(update?.sessionUpdate, "plan");
    assert.deepEqual(
      update.entries.map((entry) => entry.status),
      ["completed", "in_progress"],
    );
    assert.deepEqual(
      update.entries.map((entry) => entry.content),
      ["Inspect code", "Run tests"],
    );
  });

  it("maps subagent tool calls to stable prefixed ACP tool ids and titles", () => {
    const mapper = new PeaRuntimeToAcpEvents();
    const [update] = mapper.translate({
      type: "tool_started",
      toolCallId: "subagent:parent-1:search_content",
      toolName: "search_content",
      title: "subagent: explore -> search_content",
      status: "running",
      input: { pattern: "ACP" },
    });

    assert.equal(update?.sessionUpdate, "tool_call");
    assert.equal(update.toolCallId, "subagent:parent-1:search_content");
    assert.equal(update.title, "subagent: explore -> search_content");
    assert.equal(update.kind, "search");
    assert.deepEqual(update.rawInput, { pattern: "ACP" });
  });

  it("streams assistant message deltas without depending on Mastra message shape", () => {
    const mapper = new PeaRuntimeToAcpEvents();

    const first = mapper.translate(messageDelta("Hello"));
    const second = mapper.translate(messageDelta(" there"));

    assert.equal(first[0]?.sessionUpdate, "agent_message_chunk");
    assert.equal(first[0].content.type, "text");
    assert.equal(first[0].content.text, "Hello");
    assert.equal(second[0]?.sessionUpdate, "agent_message_chunk");
    assert.equal(second[0].content.type, "text");
    assert.equal(second[0].content.text, " there");
  });
});

function messageDelta(delta: string): PeaRuntimeEvent {
  return {
    type: "assistant_message_delta",
    messageId: "message-1",
    delta,
  };
}
