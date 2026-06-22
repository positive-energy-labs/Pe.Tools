import { expect, test } from "vite-plus/test";
import {
  isWorkbenchEvent,
  isWorkbenchState,
  readWorkbenchLoadThreadResponse,
  type WorkbenchEvent,
  type WorkbenchSessionInfo,
  type WorkbenchState,
} from "../src/index.ts";

const session: WorkbenchSessionInfo = {
  sessionId: "s1",
  cwd: "/repo",
  additionalDirectories: [],
};

const minimalState: WorkbenchState = {
  agent: {},
  threads: { items: [], status: "idle" },
  transcript: { messages: [], status: "idle" },
  tools: { calls: [], activeToolCallIds: [], recentToolCallIds: [], rawIoAvailable: false },
  approvals: { requests: [] },
  plans: { entries: [] },
  models: { availableModels: [], recentModelIds: [] },
  modes: { availableModes: [] },
  access: { availableAccessLevels: [] },
  memory: { entries: [] },
  inspector: { contextEntries: [], rawMessages: [] },
  debug: { events: [] },
  uiPreferences: {
    activePanel: "transcript",
    sidebarVisible: true,
    inspectorVisible: true,
    timestampsVisible: true,
    reasoningVisible: true,
    toolDetailsVisible: true,
    rawIoVisible: false,
    compactToolOutput: false,
    diffWrap: "word",
  },
  uiStatus: {
    overall: { status: "idle" },
    start: { status: "idle" },
    send: { status: "idle" },
    threads: { status: "idle" },
    loadThread: { status: "idle" },
    cancel: { status: "idle" },
    model: { status: "idle" },
    mode: { status: "idle" },
    errors: [],
  },
};

test("isWorkbenchEvent accepts representative event variants", () => {
  const events: WorkbenchEvent[] = [
    { type: "agent_initialized", agent: { name: "pea", capabilities: {} } },
    { type: "session_started", session },
    {
      type: "message_part_delta",
      messageId: "m1",
      role: "assistant",
      part: { kind: "text", text: "hi" },
    },
    { type: "run_status_changed", status: "running", stopReason: "end_turn" },
    { type: "threads_replaced", threads: [{ threadId: "t1" }], activeThreadId: "t1" },
    { type: "error", message: "boom" },
  ];
  for (const event of events) expect(isWorkbenchEvent(event)).toBe(true);
});

test("isWorkbenchEvent rejects unknown types and missing required fields", () => {
  expect(isWorkbenchEvent({ type: "not_a_real_event" })).toBe(false);
  expect(isWorkbenchEvent({ type: "agent_initialized" })).toBe(false); // no agent
  expect(isWorkbenchEvent({ type: "error" })).toBe(false); // no message
  expect(isWorkbenchEvent({ type: "run_status_changed", status: "nope" })).toBe(false);
  expect(isWorkbenchEvent(null)).toBe(false);
});

test("schemas stay lenient: extra keys pass through, null optionals are accepted", () => {
  expect(isWorkbenchEvent({ type: "error", message: "x", futureField: 123 })).toBe(true);
  expect(
    isWorkbenchEvent({ type: "thread_selected", threadId: null }), // nullish optional
  ).toBe(true);
});

test("isWorkbenchState validates the shape and rejects junk", () => {
  expect(isWorkbenchState(minimalState)).toBe(true);
  expect(isWorkbenchState({ agent: {} })).toBe(false); // missing the rest
  expect(isWorkbenchState({})).toBe(false);
});

test("readWorkbenchLoadThreadResponse round-trips a valid response and rejects a bad one", () => {
  const ok = readWorkbenchLoadThreadResponse({
    session,
    messages: [
      { id: "m1", role: "user", parts: [{ kind: "text", text: "hi" }], status: "complete" },
    ],
  });
  expect(ok?.session.sessionId).toBe("s1");
  expect(ok?.messages?.[0]?.id).toBe("m1");
  expect(readWorkbenchLoadThreadResponse({ session: { cwd: "/repo" } })).toBeUndefined(); // no sessionId
});
