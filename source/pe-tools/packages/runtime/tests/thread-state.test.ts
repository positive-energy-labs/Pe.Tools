import type { AgentController } from "@mastra/core/agent-controller";
import type { MastraCompositeStore } from "@mastra/core/storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { buildAgentControllerApp } from "../src/agent-controller-web.ts";
import { createDeterministicRuntime } from "../src/testing.ts";
import {
  DEFERRED_TOOL_RESULT_BYTES,
  endParkedTurn,
  projectThreadMessages,
  readToolResult,
  selectEndedCalls,
} from "../src/thread-state.ts";

type ThreadMessage = Awaited<ReturnType<AgentController["queryThreadMessages"]>>[number];

const invocation = (
  messageId: string,
  toolCallId: string,
  result: unknown,
  state = "result",
): ThreadMessage =>
  ({
    id: messageId,
    role: "assistant",
    createdAt: new Date("2026-09-16T00:00:00.000Z"),
    content: {
      format: 2,
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: { state, step: 0, toolCallId, toolName: "pe_read", args: {}, result },
        },
      ],
    },
  }) as ThreadMessage;

test("large successful results become top-level refs without mutating transcript storage", () => {
  const result = { rows: ["é".repeat(DEFERRED_TOOL_RESULT_BYTES)] };
  const unchanged = invocation("message-2", "call-2", { small: true });
  const stored = [invocation("message-1", "call-1", result), unchanged];
  const projected = projectThreadMessages(stored);

  expect(projected.deferredResults).toEqual([
    {
      messageId: "message-1",
      toolCallId: "call-1",
      byteSize: new TextEncoder().encode(JSON.stringify(result)).byteLength,
      summary: { kind: "object", keyCount: 1, keys: ["rows"] },
    },
  ]);
  expect(projected.messages[0].content.parts[0]).not.toHaveProperty("toolInvocation.result");
  expect(stored[0].content.parts[0]).toHaveProperty("toolInvocation.result", result);
  expect(projected.messages[0]).not.toBe(stored[0]);
  expect(projected.messages[1]).toBe(unchanged);
});

test("threshold results and failures stay inline", () => {
  const exact = "x".repeat(DEFERRED_TOOL_RESULT_BYTES - 2);
  const failed = { error: true, message: "x".repeat(DEFERRED_TOOL_RESULT_BYTES) };
  const projected = projectThreadMessages([
    invocation("exact", "exact", exact),
    invocation("failed", "failed", failed),
    invocation("denied", "denied", "x".repeat(DEFERRED_TOOL_RESULT_BYTES), "output-denied"),
  ]);

  expect(projected.deferredResults).toEqual([]);
  for (const message of projected.messages)
    expect(message.content.parts[0]).toHaveProperty("toolInvocation.result");
});

test("a stored suspension remains an expired ask when its setting record is missing", async () => {
  const message = invocation("message", "ask", undefined, "call");
  const part = message.content.parts[0];
  if (part?.type === "tool-invocation") part.toolInvocation.toolName = "ask_user";
  message.content.metadata = { suspendedTools: { ask: { toolName: "ask_user" } } };
  const session = {
    displayState: {
      get: () => ({
        isRunning: false,
        activeTools: new Map(),
        pendingSuspensions: new Map(),
      }),
    },
    suspensions: { has: () => false },
    thread: {
      getSetting: () => Promise.resolve(undefined),
    },
  } as never;

  await expect(selectEndedCalls([message], session)).resolves.toEqual({
    expiredAsks: [{ messageId: "message", toolCallId: "ask", toolName: "ask_user" }],
    cancelledCalls: [],
  });
});

test("a stale display suspension cannot keep a cancelled stored ask live", async () => {
  const message = invocation("message", "ask", undefined, "call");
  const part = message.content.parts[0];
  if (part?.type === "tool-invocation") part.toolInvocation.toolName = "ask_user";
  message.content.metadata = { suspendedTools: { ask: { toolName: "ask_user" } } };
  const session = {
    displayState: {
      get: () => ({
        isRunning: false,
        activeTools: new Map(),
        pendingSuspensions: new Map([["ask", {}]]),
      }),
    },
    suspensions: { has: () => false },
    thread: { getSetting: () => Promise.resolve(undefined) },
  } as never;

  await expect(selectEndedCalls([message], session)).resolves.toEqual({
    expiredAsks: [{ messageId: "message", toolCallId: "ask", toolName: "ask_user" }],
    cancelledCalls: [],
  });
});

test("large strings report characters without copying a preview", () => {
  const result = "é".repeat(DEFERRED_TOOL_RESULT_BYTES);
  expect(projectThreadMessages([invocation("string", "string", result)]).deferredResults).toEqual([
    {
      messageId: "string",
      toolCallId: "string",
      byteSize: new TextEncoder().encode(JSON.stringify(result)).byteLength,
      summary: { kind: "string", characters: result.length },
    },
  ]);
});

test("exact result lookup uses message and call identity and rejects duplicates in one message", async () => {
  const messages = [
    invocation("message-a", "shared-call", { value: "A" }),
    invocation("message-b", "shared-call", { value: "B" }),
  ];
  const controller = {
    init: async () => undefined,
    queryThreadMessages: async () => messages,
  } as Pick<AgentController, "init" | "queryThreadMessages">;

  await expect(
    readToolResult({ controller }, "thread", "message-b", "shared-call"),
  ).resolves.toEqual({
    status: 200,
    body: { messageId: "message-b", toolCallId: "shared-call", result: { value: "B" } },
  });
  await expect(readToolResult({ controller }, "thread", "missing", "shared-call")).resolves.toEqual(
    { status: 404, body: { error: "tool result not found" } },
  );

  const duplicate = structuredClone(messages[0]);
  duplicate.content.parts.push(structuredClone(duplicate.content.parts[0]));
  const duplicateController = {
    ...controller,
    queryThreadMessages: async () => [duplicate],
  } as Pick<AgentController, "init" | "queryThreadMessages">;
  await expect(
    readToolResult({ controller: duplicateController }, "thread", "message-a", "shared-call"),
  ).resolves.toEqual({ status: 409, body: { error: "tool call identity is ambiguous" } });
});

test("the HTTP endpoint returns the original deferred result", async () => {
  const threadId = "deferred-thread";
  const resourceId = "deferred-resource";
  const result = ["x".repeat(DEFERRED_TOOL_RESULT_BYTES)];
  const runtime = await createDeterministicRuntime({
    databasePath: join(await mkdtemp(join(tmpdir(), "pe-deferred-")), "runtime.db"),
    resourceId,
    responses: [{ text: "unused" }],
  });
  try {
    const storage = runtime.storage as MastraCompositeStore;
    const memory = await storage.getStore("memory");
    if (!memory) throw new Error("missing memory store");
    const createdAt = new Date("2026-09-16T00:00:00.000Z");
    await memory.saveThread({
      thread: { id: threadId, resourceId, title: "Deferred", createdAt, updatedAt: createdAt },
    });
    await memory.saveMessages({
      messages: [
        {
          ...invocation("message/1", "call/1", result),
          threadId,
          resourceId,
        } as never,
      ],
    });

    const app = await buildAgentControllerApp({ runtime, label: "pea" });
    const createSession = vi.spyOn(runtime.controller, "createSession");
    const missing = await app.fetch(
      new Request("http://local/pe/thread/missing/tool-result/message/call"),
    );
    expect(missing.status).toBe(404);
    expect(createSession).not.toHaveBeenCalled();
    createSession.mockRestore();

    const thread = await app.fetch(new Request(`http://local/pe/thread/${threadId}`));
    const body = (await thread.json()) as {
      messages: ThreadMessage[];
      deferredResults: Array<{ byteSize: number; summary: unknown }>;
    };
    expect(body.deferredResults).toEqual([
      {
        messageId: "message/1",
        toolCallId: "call/1",
        byteSize: new TextEncoder().encode(JSON.stringify(result)).byteLength,
        summary: { kind: "array", items: 1 },
      },
    ]);
    expect(body.messages[0].content.parts[0]).not.toHaveProperty("toolInvocation.result");

    const response = await app.fetch(
      new Request(
        `http://local/pe/thread/${threadId}/tool-result/${encodeURIComponent("message/1")}/${encodeURIComponent("call/1")}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      messageId: "message/1",
      toolCallId: "call/1",
      result,
    });
  } finally {
    await runtime.close?.();
  }
});

test("a new turn that cannot record the expired ask fails visibly, never silently (F-J5-2)", async () => {
  // A silent skip left the stored call parked, so a reload showed the ask live again.
  const parked = (threadId: string | null, memory: unknown) =>
    ({
      suspensions: {
        hasPending: () => true,
        clear: () => [{ toolCallId: "call-1", toolName: "ask" }],
      },
      emit: () => undefined,
      abort: () => undefined,
      stream: { isOpen: () => false },
      run: { isRunning: () => false, isAbortRequested: () => false },
      thread: { getId: () => threadId },
      machinery: {
        getAgent: () => ({
          getMastraInstance: () => ({ getStorage: () => ({ getStore: async () => memory }) }),
        }),
      },
    }) as never;
  await expect(endParkedTurn(parked("t", undefined))).rejects.toThrow(
    "Cannot record the expired ask: the runtime has no memory store.",
  );
  await expect(endParkedTurn(parked(null, {}))).rejects.toThrow(
    "Cannot record the expired ask: the session has no thread.",
  );
});
