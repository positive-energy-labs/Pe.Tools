import type { Agent } from "@agentclientprotocol/sdk";
import { expect, test } from "vite-plus/test";
import { AcpWorkbenchClient } from "../src/index.ts";

function createClient(fakeAgent: Partial<Agent> = {}) {
  const client = new AcpWorkbenchClient({ clientName: "test", clientVersion: "0.1.0" });
  const events: unknown[] = [];
  client.subscribe((event) => events.push(event));
  client.connect({
    closed: Promise.resolve(),
    signal: new AbortController().signal,
    initialize: async () => ({
      protocolVersion: 1,
      agentInfo: { name: "agent" },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: true },
        providers: {},
      },
    }),
    newSession: async () => ({
      sessionId: "session-1",
      modes: { currentModeId: "agent", availableModes: [] },
    }),
    listSessions: async () => ({
      sessions: [
        { sessionId: "session-1", title: "Current" },
        { sessionId: "thread-2", title: "Existing" },
      ],
    }),
    loadSession: async () => ({ modes: { currentModeId: "agent", availableModes: [] } }),
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => ({}),
    setSessionMode: async () => ({}),
    ...fakeAgent,
  } as never);
  return { client, events };
}

test("maps ACP session list and load to workbench thread/session semantics", async () => {
  const { client, events } = createClient();

  const info = await client.initialize();
  const threads = await client.listThreads("C:/repo");
  const session = await client.loadThread({ threadId: "thread-2", cwd: "C:/repo" });

  expect(info.capabilities).toEqual(
    expect.objectContaining({
      threads: true,
      history: true,
      modelSwitching: true,
      sessionModes: true,
    }),
  );
  expect(threads).toEqual([
    expect.objectContaining({ threadId: "session-1", sessionId: "session-1", cwd: "C:/repo" }),
    expect.objectContaining({ threadId: "thread-2", sessionId: "thread-2", cwd: "C:/repo" }),
  ]);
  expect(session).toEqual({ sessionId: "thread-2", cwd: "C:/repo", additionalDirectories: [] });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "threads_replaced" }),
      expect.objectContaining({ type: "approvals_cleared", reason: "thread_loaded" }),
      expect.objectContaining({ type: "session_started" }),
    ]),
  );
});

test("resolves approval requests by stable session/tool key", async () => {
  const { client, events } = createClient();
  const responsePromise = client.requestPermission({
    sessionId: "session-1",
    toolCall: { toolCallId: "tool-1", title: "Edit", status: "pending" },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  } as never);

  client.resolveApproval("session-1:tool-1", "allow");

  await expect(responsePromise).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow" },
  });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "approval_requested",
        approval: expect.objectContaining({
          requestId: "session-1:tool-1",
          status: "pending",
          defaultOptionId: "allow",
        }),
      }),
      expect.objectContaining({ type: "approval_resolved", requestId: "session-1:tool-1" }),
    ]),
  );
});

test("cancels pending approvals on close", async () => {
  const { client, events } = createClient();
  const responsePromise = client.requestPermission({
    sessionId: "session-1",
    toolCall: { toolCallId: "tool-1", title: "Edit", status: "pending" },
    options: [{ optionId: "deny", name: "Deny", kind: "reject_once" }],
  } as never);

  await client.close();

  await expect(responsePromise).resolves.toEqual({ outcome: { outcome: "cancelled" } });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "approval_resolved", requestId: "session-1:tool-1" }),
    ]),
  );
});

test("sets ACP session mode for the active session", async () => {
  const calls: unknown[] = [];
  const { client } = createClient({
    setSessionMode: async (request) => {
      calls.push(request);
      return {};
    },
  });

  await client.newSession({ cwd: "C:/repo" });
  await client.setMode("ask");

  expect(calls).toEqual([{ sessionId: "session-1", modeId: "ask" }]);
});
