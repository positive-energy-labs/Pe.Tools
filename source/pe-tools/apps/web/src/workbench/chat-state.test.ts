import { expect, test } from "vite-plus/test";
import type { KnownAgentControllerEvent, MastraDBMessage } from "@mastra/client-js";
import {
  applyEvent,
  emptyChatState,
  selectApprovals,
  selectRunStatus,
  selectToolCalls,
  type ChatState,
} from "./chat-state.ts";

const userMessage = (id: string, text: string): MastraDBMessage => ({
  id,
  role: "user",
  createdAt: new Date(0),
  content: { format: 2, parts: [{ type: "text", text }] },
});

const reduce = (events: KnownAgentControllerEvent[], from = emptyChatState()) =>
  events.reduce(applyEvent, from);

test("display_state_changed is assigned whole — running, tools and tasks come from it", () => {
  const state = reduce([
    {
      type: "display_state_changed",
      displayState: {
        isRunning: true,
        activeTools: { t1: { name: "grep", args: { path: "a.ts" }, status: "running" } },
        tasks: [{ id: "p1", content: "do it", status: "in_progress", activeForm: "doing it" }],
      },
    } as unknown as KnownAgentControllerEvent,
  ]);
  expect(selectRunStatus(state)).toBe("running");
  expect(state.display.tasks?.[0]?.content).toBe("do it");
  const [call] = selectToolCalls(state);
  expect(call).toMatchObject({ id: "t1", title: "grep", status: "in_progress", target: "a.ts" });
});

test("the optimistic user echo is replaced in place by the server's canonical turn", () => {
  const state = reduce([
    { type: "message_start", message: userMessage("local-user-1", "hello") },
    { type: "message_end", message: userMessage("server-1", "hello") },
  ] as KnownAgentControllerEvent[]);
  expect(state.messages.map((message) => message.id)).toEqual(["server-1"]);
});

test("an error event's detail survives; a silent bad end falls back to Run failed.", () => {
  const detailed = reduce([
    { type: "error", error: { message: "bridge refused" } },
    { type: "agent_end", reason: "error" },
  ] as KnownAgentControllerEvent[]);
  expect(detailed.errors).toEqual(["bridge refused"]);
  expect(selectRunStatus(detailed)).toBe("error");

  const silent = reduce([{ type: "agent_end", reason: "error" }] as KnownAgentControllerEvent[]);
  expect(silent.errors).toEqual(["Run failed."]);
});

test("a suspension and an approval are both gates, and only a suspension resumes", () => {
  const state: ChatState = {
    ...emptyChatState(),
    display: {
      isRunning: true,
      pendingApproval: { toolCallId: "t1", toolName: "grep", args: {} },
      pendingSuspensions: {
        t2: {
          toolCallId: "t2",
          toolName: "ask_user",
          args: {},
          suspendPayload: { options: ["A"] },
        },
      },
    },
  };
  expect(selectApprovals(state.display)).toEqual([
    { toolCallId: "t1", toolName: "grep", suspended: false },
    {
      toolCallId: "t2",
      toolName: "ask_user",
      suspended: true,
      suspendPayload: { options: ["A"] },
    },
  ]);
  expect(selectRunStatus(state)).toBe("waiting");
});

test("a settled tool-invocation part wins over the live activeTools entry", () => {
  const withPart: ChatState = {
    ...emptyChatState(),
    display: {
      activeTools: { t1: { name: "grep", args: {}, status: "running" } },
    },
    messages: [
      {
        id: "a1",
        role: "assistant",
        createdAt: new Date(0),
        content: {
          format: 2,
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                step: 0,
                toolCallId: "t1",
                toolName: "grep",
                args: {},
                result: "hit",
              },
            },
          ],
        },
      } as unknown as MastraDBMessage,
    ],
  };
  expect(selectToolCalls(withPart)).toEqual([
    {
      id: "t1",
      title: "grep",
      status: "completed",
      args: {},
      target: undefined,
      parentMessageId: "a1",
      result: "hit",
    },
  ]);
});

test("an orphaned stored tool call is interrupted, not still in progress", () => {
  const state: ChatState = {
    ...emptyChatState(),
    messages: [
      {
        id: "a1",
        role: "assistant",
        createdAt: new Date(0),
        content: {
          format: 2,
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "call",
                step: 0,
                toolCallId: "t1",
                toolName: "grep",
                args: {},
              },
            },
          ],
        },
      } as unknown as MastraDBMessage,
      userMessage("u2", "next turn"),
    ],
  };

  expect(selectToolCalls(state)[0]).toMatchObject({
    id: "t1",
    status: "failed",
    error: "Tool call ended without a terminal result.",
  });
});
