import type { MastraDBMessage } from "@mastra/client-js";
import { expect, test, vi } from "vite-plus/test";
import { CHAT_ACTIONS } from "./actions";
import {
  emptyChatState,
  selectApprovals,
  selectExpiredAsks,
  selectToolCalls,
  type ChatState,
} from "./chat-state";

const askCall = {
  id: "a1",
  role: "assistant",
  createdAt: new Date("2026-09-18T12:00:00Z"),
  content: {
    format: 2,
    parts: [
      {
        type: "tool-invocation",
        toolInvocation: {
          state: "call",
          toolCallId: "ask-1",
          toolName: "ask_user",
          args: { question: "Which?" },
        },
      },
    ],
  },
} as unknown as MastraDBMessage;

const ask = { toolCallId: "ask-1", toolName: "ask_user", suspendPayload: { question: "Which?" } };

test("cancel expires open asks; it never answers them", async () => {
  const session = {
    sendMessage: vi.fn(),
    abort: vi.fn(async () => {}),
    approveTool: vi.fn(),
    respondToToolSuspension: vi.fn(),
  };
  await CHAT_ACTIONS.cancel.run({
    session,
    display: {
      pendingApproval: { toolCallId: "gate-1", toolName: "write", args: {} },
      pendingSuspensions: { [ask.toolCallId]: ask },
    } as unknown as ChatState["display"],
  });
  expect(session.abort).toHaveBeenCalledTimes(1);
  expect(session.approveTool).not.toHaveBeenCalled();
  expect(session.respondToToolSuspension).not.toHaveBeenCalled();
});

test("an expired ask is a record with no live approval, not a failed call", () => {
  // After a host restart: the stored call never reached a terminal state and nothing is live.
  const state: ChatState = {
    ...emptyChatState(),
    messages: [askCall],
    expiredAsks: [{ messageId: "a1", toolCallId: "ask-1", toolName: "ask_user" }],
  };
  expect(selectApprovals(state.display)).toEqual([]);
  expect(selectToolCalls(state)).toEqual([
    expect.objectContaining({ id: "ask-1", status: "expired" }),
  ]);
  expect(selectExpiredAsks(state)).toEqual([
    { messageId: "a1", toolCallId: "ask-1", toolName: "ask_user" },
  ]);
});

test("a live ask stays live and is never listed as expired", () => {
  const state: ChatState = {
    ...emptyChatState(),
    messages: [askCall],
    display: { isRunning: false, pendingSuspensions: { [ask.toolCallId]: ask } } as never,
  };
  expect(selectApprovals(state.display).map((item) => item.toolCallId)).toEqual(["ask-1"]);
  expect(selectExpiredAsks(state)).toEqual([]);
  expect(selectToolCalls(state)[0]?.status).not.toBe("expired");
});
