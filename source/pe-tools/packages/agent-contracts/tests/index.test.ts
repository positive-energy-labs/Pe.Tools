import { expect, test } from "vite-plus/test";
import { isWorkbenchState, type WorkbenchState } from "../src/index.ts";

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
  sessionState: { values: {}, hydrated: false },
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

test("isWorkbenchState validates the shape and rejects junk", () => {
  expect(isWorkbenchState(minimalState)).toBe(true);
  expect(isWorkbenchState({ agent: {} })).toBe(false);
  expect(isWorkbenchState({})).toBe(false);
});
