import { describe, expect, it } from "vite-plus/test";
import {
  createWorkbenchState,
  type WorkbenchApprovalRequest,
  type WorkbenchMessage,
  type WorkbenchState,
  type WorkbenchToolCall,
} from "@pe/agent-contracts";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { workbenchToThreadMessages } from "../src/workbench/aui-adapter.ts";

// The render-from-WorkbenchState projection is the contract that lets assistant-ui render
// our chat without owning state. These hermetic tests pin the fold: tools become tool-call
// parts on their parent assistant message, orphans fall to the last assistant turn, and a
// pending approval surfaces on its tool-call part with hyphenated option kinds.

function msg(id: string, role: WorkbenchMessage["role"], text: string): WorkbenchMessage {
  return { id, role, status: "complete", parts: [{ kind: "text", text }] };
}

function tool(id: string, title: string, parentMessageId?: string): WorkbenchToolCall {
  return {
    id,
    title,
    status: "completed",
    rawInput: { path: "x.ts" },
    rawOutput: "ok",
    parentMessageId,
  };
}

function stateWith(
  messages: WorkbenchMessage[],
  calls: WorkbenchToolCall[],
  requests: WorkbenchApprovalRequest[] = [],
): WorkbenchState {
  return {
    ...createWorkbenchState(),
    transcript: { status: "loaded", messages },
    tools: { activeToolCallIds: [], recentToolCallIds: [], rawIoAvailable: true, calls },
    approvals: { requests },
  };
}

function toolCallParts(message: ThreadMessageLike) {
  const content = message.content;
  if (typeof content === "string") return [];
  return content.filter((part) => part.type === "tool-call");
}

const MESSAGES: WorkbenchMessage[] = [
  msg("u1", "user", "first ask"),
  msg("a1", "assistant", "answer one"),
  msg("u2", "user", "second ask"),
  msg("a2", "assistant", "answer two"),
];

describe("workbenchToThreadMessages", () => {
  it("maps roles and folds each tool into its parent assistant message", () => {
    const result = workbenchToThreadMessages(
      stateWith(MESSAGES, [
        tool("t1", "pe_status", "a1"),
        tool("t2", "grep", "a1"),
        tool("t3", "host_call", "a2"),
      ]),
    );

    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(toolCallParts(result[1]!).map((p) => p.toolName)).toEqual(["pe_status", "grep"]);
    expect(toolCallParts(result[3]!).map((p) => p.toolName)).toEqual(["host_call"]);
    // object rawInput becomes structured args (not argsText)
    expect(toolCallParts(result[1]!)[0]).toMatchObject({
      toolCallId: "t1",
      args: { path: "x.ts" },
    });
  });

  it("anchors orphan tools (no parent) to the last assistant turn", () => {
    const result = workbenchToThreadMessages(
      stateWith(MESSAGES, [tool("t1", "pe_status"), tool("t2", "grep")]),
    );
    expect(toolCallParts(result[1]!)).toHaveLength(0); // a1
    expect(toolCallParts(result[3]!).map((p) => p.toolName)).toEqual(["pe_status", "grep"]); // a2
  });

  it("surfaces a pending approval on its tool-call part with hyphenated kinds", () => {
    const approval: WorkbenchApprovalRequest = {
      requestId: "r1",
      sessionId: "s1",
      status: "pending",
      toolCall: { id: "t1", title: "write_file", status: "pending" },
      options: [
        { optionId: "allow_once", name: "Approve", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny", kind: "reject_once" },
      ],
    };
    const result = workbenchToThreadMessages(
      stateWith(
        [msg("u1", "user", "go"), msg("a1", "assistant", "")],
        [tool("t1", "write_file", "a1")],
        [approval],
      ),
    );

    const part = toolCallParts(result[1]!)[0]!;
    expect(part.approval?.id).toBe("r1");
    expect(part.approval?.options?.map((o) => o.kind)).toEqual(["allow-once", "reject-once"]);
    expect(part.approval?.approved).toBeUndefined();
  });

  it("projects reasoning parts to reasoning content", () => {
    const assistant: WorkbenchMessage = {
      id: "a1",
      role: "assistant",
      status: "complete",
      parts: [
        { kind: "reasoning", text: "thinking…" },
        { kind: "text", text: "answer" },
      ],
    };
    const result = workbenchToThreadMessages(stateWith([assistant], []));
    const content = result[0]!.content;
    const kinds = typeof content === "string" ? [] : content.map((part) => part.type);
    expect(kinds).toEqual(["reasoning", "text"]);
  });
});
