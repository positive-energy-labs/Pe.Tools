import { expect, test } from "vite-plus/test";
import {
  createWorkbenchState,
  selectActiveThread,
  selectActiveThreadId,
  selectVisibleThreads,
} from "../src/index.ts";

test("visible thread selectors dedupe the current materialized session and resolve active id", () => {
  const state = createWorkbenchState();
  state.agent.session = {
    sessionId: "session-current",
    cwd: "C:/repo",
    additionalDirectories: [],
    title: "Current",
  };
  state.threads = {
    items: [
      { threadId: "session-current", sessionId: "session-current", title: "Draft Current" },
      { threadId: "thread-current", sessionId: "session-current", title: "Current" },
      { threadId: "thread-other", title: "Other" },
    ],
    activeThreadId: "session-current",
    selectedThreadId: "session-current",
    status: "loaded",
  };

  expect(selectVisibleThreads(state).map((thread) => thread.threadId)).toEqual([
    "thread-current",
    "thread-other",
  ]);
  expect(selectActiveThreadId(state)).toBe("thread-current");
  expect(selectActiveThread(state)).toEqual(
    expect.objectContaining({ threadId: "thread-current" }),
  );
});
