import { describe, expect, it } from "vite-plus/test";
import {
  createWorkbenchState,
  type WorkbenchDebugEvent,
  type WorkbenchMessage,
  type WorkbenchState,
  type WorkbenchToolCall,
} from "@pe/agent-contracts";
import { buildRows } from "../src/workbench/rows.ts";

function ev(
  type: string,
  sequence: number,
  extra: Record<string, unknown> = {},
): WorkbenchDebugEvent {
  return {
    id: `${type}:${sequence}`,
    source: "ag-ui",
    type,
    payload: { type, sequence, ...extra },
  };
}

function msg(id: string, role: WorkbenchMessage["role"], text: string): WorkbenchMessage {
  return { id, role, status: "complete", parts: [{ kind: "text", text }] };
}

function tool(id: string, title: string, parentMessageId?: string): WorkbenchToolCall {
  return { id, title, status: "completed", rawInput: {}, rawOutput: "ok", parentMessageId };
}

// Reproduces the live bug: a 2-run thread whose final transcript comes from
// MESSAGES_SNAPSHOT (message ids don't match streaming event ids) and whose tool
// calls only exist in tools.calls. Past tool calls must survive and sit with their run.
function twoRunState(): WorkbenchState {
  return {
    ...createWorkbenchState(),
    transcript: {
      status: "loaded",
      messages: [
        msg("u1", "user", "first ask"),
        msg("a1", "assistant", "answer one"),
        msg("u2", "user", "second ask"),
        msg("a2", "assistant", "answer two"),
      ],
    },
    tools: {
      activeToolCallIds: [],
      recentToolCallIds: [],
      rawIoAvailable: true,
      calls: [tool("t1", "pe_status"), tool("t2", "grep"), tool("t3", "host_call")],
    },
    debug: {
      events: [
        ev("RUN_STARTED", 1),
        ev("TOOL_CALL_START", 3, { toolCallId: "t1" }),
        ev("TOOL_CALL_START", 5, { toolCallId: "t2" }),
        ev("TEXT_MESSAGE_CONTENT", 10, { messageId: "stream-1" }),
        ev("RUN_STARTED", 20),
        ev("TOOL_CALL_START", 22, { toolCallId: "t3" }),
        ev("TEXT_MESSAGE_CONTENT", 30, { messageId: "stream-2" }),
      ],
    },
  };
}

describe("buildRows", () => {
  it("keeps past tool calls and slots each with the run it belongs to", () => {
    const rows = buildRows(twoRunState(), "trace");
    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
      "assistant",
      "tool",
    ]);
    expect(rows.filter((row) => row.kind === "tool").map((row) => row.toolCall?.title)).toEqual([
      "pe_status",
      "grep",
      "host_call",
    ]);
  });

  it("hydrated thread (no debug seqs): anchors tool calls to parentMessageId, not the end", () => {
    // A reloaded thread has no streaming events, so seqByTool is empty. Without the
    // parentMessageId fallback every tool dumps after the last message.
    const state: WorkbenchState = {
      ...createWorkbenchState(),
      transcript: {
        status: "loaded",
        messages: [
          msg("u1", "user", "first ask"),
          msg("a1", "assistant", "answer one"),
          msg("u2", "user", "second ask"),
          msg("a2", "assistant", "answer two"),
        ],
      },
      tools: {
        activeToolCallIds: [],
        recentToolCallIds: [],
        rawIoAvailable: true,
        calls: [
          tool("t1", "pe_status", "a1"),
          tool("t2", "grep", "a1"),
          tool("t3", "host_call", "a2"),
        ],
      },
      debug: { events: [] },
    };
    expect(buildRows(state, "trace").map((row) => row.kind)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
      "assistant",
      "tool",
    ]);
  });

  it("prefers parentMessageId over run sequence when both are present", () => {
    const state = twoRunState();
    state.tools.calls = [
      tool("t1", "pe_status", "a1"),
      tool("t2", "grep", "a1"),
      tool("t3", "host_call", "a2"),
    ];
    state.debug.events.push(ev("TOOL_CALL_START", 24, { toolCallId: "t1" }));

    const rows = buildRows(state, "trace");
    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
      "assistant",
      "tool",
    ]);
    expect(rows[2]?.toolCall?.id).toBe("t1");
  });

  it("at strata, unmatched run-level events become a trailing events row", () => {
    const rows = buildRows(twoRunState(), "strata");
    expect(rows.at(-1)?.kind).toBe("event");
  });

  it("read depth shows no memory rows", () => {
    const state = twoRunState();
    state.memory = {
      entries: [{ id: "m1", kind: "observation", status: "complete", summary: "x" }],
    };
    expect(buildRows(state, "read").some((row) => row.kind === "memory")).toBe(false);
    expect(buildRows(state, "trace").some((row) => row.kind === "memory")).toBe(true);
  });

  it("does not render configuration-only memory metadata as a conversation row", () => {
    const state = twoRunState();
    state.memory = {
      entries: [
        {
          id: "pea-memory:observational-config",
          kind: "observation",
          status: "activated",
          title: "Observational memory configuration",
          summary: "Thread-scoped observational memory is configured for Pea.",
        },
        {
          id: "m1",
          kind: "observation",
          status: "complete",
          summary: "A useful persisted observation.",
        },
      ],
    };

    expect(
      buildRows(state, "trace")
        .filter((row) => row.kind === "memory")
        .map((row) => row.memory?.id),
    ).toEqual(["m1"]);
  });
});
