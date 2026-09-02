import { expect, test } from "vite-plus/test";
import type { MastraDBMessage } from "@mastra/client-js";
import { emptyChatState } from "./chat-state.ts";
import { toThreadMessages } from "./aui-adapter.ts";

const message = (parts: MastraDBMessage["content"]["parts"]): MastraDBMessage => ({
  id: "a1",
  role: "assistant",
  createdAt: new Date(0),
  content: { format: 2, parts },
});

type LoosePart = {
  type: string;
  toolCallId?: string;
  result?: unknown;
  approval?: { id: string };
};

const toolParts = (content: unknown): LoosePart[] => content as LoosePart[];

const invocation = (toolCallId: string, toolName: string, extra: Record<string, unknown> = {}) =>
  ({
    type: "tool-invocation",
    toolInvocation: { state: "call", step: 0, toolCallId, toolName, args: {}, ...extra },
  }) as unknown as MastraDBMessage["content"]["parts"][number];

test("tool calls render where the model emitted them, not all at the end", () => {
  const state = {
    ...emptyChatState(),
    messages: [
      message([
        { type: "text", text: "before" },
        invocation("t1", "grep"),
        { type: "text", text: "after" },
      ]),
    ],
  };

  const [rendered] = toThreadMessages(state);
  if (!Array.isArray(rendered!.content)) throw new Error("expected structured message content");
  expect(rendered!.content.map((part) => part.type)).toEqual(["text", "tool-call", "text"]);
});

test("a tool in flight comes from display.activeTools, then done from its part", () => {
  const live = {
    ...emptyChatState(),
    display: {
      isRunning: true,
      activeTools: { t9: { name: "grep", args: { path: "a.ts" }, status: "running" } },
    },
    messages: [message([{ type: "text", text: "working" }])],
  } as ReturnType<typeof emptyChatState>;
  const [running] = toThreadMessages(live);
  const inFlight = toolParts(running!.content).find((part) => part.type === "tool-call");
  expect(inFlight).toBeDefined();
  expect(inFlight!.result).toBeUndefined();

  const settled = {
    ...live,
    display: { isRunning: false, activeTools: {} },
    messages: [
      message([
        { type: "text", text: "working" },
        invocation("t9", "grep", { state: "result", result: "hit" }),
      ]),
    ],
  } as ReturnType<typeof emptyChatState>;
  const [done] = toThreadMessages(settled);
  const landed = toolParts(done!.content).find((part) => part.type === "tool-call");
  expect(landed!.result).toBe("hit");
});

test("a pending approval gates its tool call and nothing else", () => {
  const state = {
    ...emptyChatState(),
    display: { pendingApproval: { toolCallId: "t1", toolName: "grep", args: {} } },
    messages: [message([invocation("t1", "grep"), invocation("t2", "read")])],
  } as ReturnType<typeof emptyChatState>;
  const parts = toolParts(toThreadMessages(state)[0]!.content);
  expect(parts.find((part) => part.toolCallId === "t1")!.approval!.id).toBe("t1");
  expect(parts.find((part) => part.toolCallId === "t2")!.approval).toBeUndefined();
});

test("a persisted user turn (signal row of type user) projects as a user message", () => {
  const state = {
    ...emptyChatState(),
    messages: [
      {
        id: "client-1",
        role: "signal",
        type: "user",
        createdAt: new Date(0),
        content: { format: 2, parts: [{ type: "text", text: "hello" }] },
      } as MastraDBMessage,
      message([{ type: "text", text: "ok" }]),
    ],
  };
  expect(toThreadMessages(state).map((m) => m.role)).toEqual(["user", "assistant"]);
});

test("a live user signal (metadata.signal.type user, data-user-message part) projects with its text", () => {
  const state = {
    ...emptyChatState(),
    messages: [
      {
        id: "client-2",
        role: "signal",
        createdAt: new Date(0),
        content: {
          format: 2,
          parts: [
            {
              type: "data-user-message",
              data: { type: "user", tagName: "user", contents: "live" },
            },
          ],
          metadata: { signal: { type: "user", tagName: "user", contents: "live" } },
        },
      } as unknown as MastraDBMessage,
    ],
  };
  const [turn] = toThreadMessages(state);
  expect(turn?.role).toBe("user");
  expect(turn?.content).toEqual([{ type: "text", text: "live" }]);
});
