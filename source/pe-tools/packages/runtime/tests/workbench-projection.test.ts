import {
  applyWorkbenchEvent,
  createWorkbenchState,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import {
  RuntimeToWorkbenchEvents,
  runtimeMessagesToWorkbenchEvents,
  type RuntimeEvent,
  type RuntimeThreadMessage,
} from "@pe/runtime";

// The highest-leverage hermetic test: a recorded RuntimeEvent stream projected
// through RuntimeToWorkbenchEvents + applyWorkbenchEvent must yield a coherent
// WorkbenchState. This single test crosses the web adapter, the zod contracts,
// and the reducer — the exact layers where the historic projection bugs lived.

function project(events: RuntimeEvent[], initial = createWorkbenchState()): WorkbenchState {
  const translator = new RuntimeToWorkbenchEvents({ sessionId: "s1", threadId: "t1" });
  let state = initial;
  for (const event of events) {
    for (const workbenchEvent of translator.translate(event)) {
      state = applyWorkbenchEvent(state, workbenchEvent);
    }
  }
  return state;
}

const run1: RuntimeEvent[] = [
  { type: "run_started" },
  { type: "assistant_message_started", messageId: "a1" },
  { type: "assistant_message_delta", messageId: "a1", delta: "Listing " },
  {
    type: "tool_started",
    toolCallId: "c1",
    toolName: "list_files",
    status: "running",
    input: { path: "." },
  },
  {
    type: "tool_finished",
    toolCallId: "c1",
    toolName: "list_files",
    isError: false,
    result: "a.ts\nb.ts",
  },
  { type: "assistant_message_delta", messageId: "a1", delta: "done." },
  { type: "assistant_message_finished", messageId: "a1" },
  { type: "plan_updated", tasks: [{ content: "step one", status: "completed" }] },
  { type: "run_finished", reason: "complete" },
];

test("live RuntimeEvent stream projects to a coherent WorkbenchState", () => {
  const state = project(run1);

  const assistant = state.transcript.messages.find((message) => message.role === "assistant");
  expect(assistant).toBeDefined();
  expect(assistant?.status).toBe("complete");
  expect(messageText(assistant)).toBe("Listing done.");

  expect(state.tools.calls).toHaveLength(1);
  const call = state.tools.calls[0]!;
  expect(call.title).toBe("list_files");
  expect(call.status).toBe("completed");
  // tools must anchor to the assistant turn that spawned them (the historic
  // "tool calls dump at the end" bug) — provenance/parentMessageId carries it.
  expect(call.parentMessageId).toBe("a1");
  expect(String(call.content)).toContain("a.ts");

  expect(state.plans.entries).toHaveLength(1);
  expect(state.plans.entries[0]!.status).toBe("completed");
  expect(state.uiStatus.overall.status).toBe("idle");
});

test("a second run appends turns rather than resetting the transcript", () => {
  // The live server emits session_updated (merge) — never session_started (wipe) —
  // between prompts. Two runs projected onto one state must accumulate.
  const afterRun1 = project(run1);
  const state = project(
    [
      { type: "run_started" },
      { type: "assistant_message_started", messageId: "a2" },
      { type: "assistant_message_delta", messageId: "a2", delta: "Second answer." },
      { type: "assistant_message_finished", messageId: "a2" },
      { type: "run_finished", reason: "complete" },
    ],
    afterRun1,
  );

  const assistants = state.transcript.messages.filter((message) => message.role === "assistant");
  expect(assistants).toHaveLength(2);
  expect(state.tools.calls).toHaveLength(1); // run 1's tool survives run 2
});

test("hydration from durable history restores transcript and completed tools", () => {
  // Tool result lives on a separate tool-role message (skipped in the transcript
  // but must still complete the call) — a real shape from the libsql ledger.
  const messages: RuntimeThreadMessage[] = [
    { id: "u1", role: "user", text: "status?", parts: [{ type: "text", text: "status?" }] },
    {
      id: "a1",
      role: "assistant",
      text: "",
      parts: [
        { type: "tool-call", toolCallId: "c1", toolName: "pe_status", args: {} },
        { type: "text", text: "REVIT_VERSION=2025" },
      ],
    },
    {
      id: "tr1",
      role: "tool",
      text: "",
      parts: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "pe_status",
          result: "2025",
          isError: false,
        },
      ],
    },
  ];

  let state = createWorkbenchState();
  for (const workbenchEvent of runtimeMessagesToWorkbenchEvents(messages)) {
    state = applyWorkbenchEvent(state, workbenchEvent);
  }

  // tool-role message is not shown in the transcript
  expect(state.transcript.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  const call = state.tools.calls.find((toolCall) => toolCall.id === "c1");
  expect(call?.status).toBe("completed");
  expect(call?.parentMessageId).toBe("a1");
});

test("a tool needing approval surfaces a pending approval that clears once it proceeds", () => {
  // accessLevel "ask" → the harness suspends the tool for approval before it runs.
  const pendingState = project([
    { type: "run_started" },
    { type: "assistant_message_started", messageId: "a1" },
    {
      type: "tool_started",
      toolCallId: "c1",
      toolName: "write_file",
      status: "pending_approval",
      input: { path: "x.ts" },
    },
  ]);

  const pending = pendingState.approvals.requests.filter((a) => a.status === "pending");
  expect(pending).toHaveLength(1);
  expect(pending[0]!.requestId).toBe("tool-approval:c1");
  expect(pending[0]!.toolCall.title).toBe("write_file");
  expect(pending[0]!.options.some((option) => option.kind === "allow_once")).toBe(true);
  expect(pendingState.uiStatus.overall.status).toBe("waiting");

  // Same stream continuing past approval: the tool finishes → the approval auto-clears.
  const resolvedState = project([
    { type: "run_started" },
    { type: "assistant_message_started", messageId: "a1" },
    {
      type: "tool_started",
      toolCallId: "c1",
      toolName: "write_file",
      status: "pending_approval",
      input: { path: "x.ts" },
    },
    {
      type: "tool_finished",
      toolCallId: "c1",
      toolName: "write_file",
      isError: false,
      result: "ok",
    },
  ]);
  expect(resolvedState.approvals.requests.filter((a) => a.status === "pending")).toHaveLength(0);
});

test("every RuntimeEvent becomes a sequence-numbered devtools breadcrumb", () => {
  const state = project(run1);

  expect(state.debug.events.length).toBeGreaterThan(0);
  expect(state.debug.events.every((event) => event.source === "runtime")).toBe(true);

  const types = state.debug.events.map((event) => event.type);
  expect(types).toContain("run_started");
  expect(types).toContain("tool_finished");
  // high-frequency deltas are intentionally skipped to keep the devtools log legible
  expect(types).not.toContain("assistant_message_delta");

  const sequences = state.debug.events.map(
    (event) => (event.payload as { sequence?: number }).sequence,
  );
  expect(sequences.every((sequence) => typeof sequence === "number")).toBe(true);
  // sequence numbers are monotonic in arrival order
  const sorted = [...sequences].sort((left, right) => Number(left) - Number(right));
  expect(sequences).toEqual(sorted);
});

function messageText(
  message: WorkbenchState["transcript"]["messages"][number] | undefined,
): string {
  if (!message) return "";
  return message.parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
}
