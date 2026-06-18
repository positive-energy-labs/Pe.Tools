import type { Agent, InitializeResponse, ListSessionsResponse } from "@agentclientprotocol/sdk";
import {
  createPeWorkbenchExtension,
  peWorkbenchLoadThreadMethod,
  peWorkbenchMetadata,
  peWorkbenchQueueMessageMethod,
  peWorkbenchSessionMetadata,
  peWorkbenchSetAccessLevelMethod,
  peWorkbenchSetModelMethod,
} from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import {
  AcpWorkbenchClient,
  createInProcessAcpWorkbenchClient,
  type AcpAgentConnection,
} from "../src/index.ts";

function createClient(fakeAgent: Partial<AcpAgentConnection> = {}) {
  const client = new AcpWorkbenchClient({ clientName: "test", clientVersion: "0.1.0" });
  const events: unknown[] = [];
  client.subscribe((event) => events.push(event));
  client.connect(Object.assign(createTestConnection(), fakeAgent));
  return { client, events };
}

function createTestConnection(): AcpAgentConnection {
  return {
    closed: Promise.resolve(),
    signal: new AbortController().signal,
    initialize: async (): Promise<InitializeResponse> => ({
      protocolVersion: 1,
      agentInfo: { name: "agent", version: "0.1.0" },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
        providers: {},
      },
    }),
    newSession: async () => ({
      sessionId: "session-1",
      modes: { currentModeId: "agent", availableModes: [] },
    }),
    listSessions: async (): Promise<ListSessionsResponse> => ({
      sessions: [
        {
          sessionId: "session-1",
          title: "Current",
          cwd: "C:/repo",
          _meta: peWorkbenchSessionMetadata({
            status: "materialized",
            threadId: "thread-1",
            resourceId: "resource-1",
            lock: { status: "owned", ownerPid: 123 },
          }),
        },
        { sessionId: "thread-2", title: "Existing", cwd: "C:/repo" },
      ],
    }),
    loadSession: async () => ({ modes: { currentModeId: "agent", availableModes: [] } }),
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => undefined,
    setSessionMode: async () => ({}),
  };
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
    expect.objectContaining({
      threadId: "thread-1",
      sessionId: "session-1",
      resourceId: "resource-1",
      lock: { status: "owned", ownerPid: 123 },
      cwd: "C:/repo",
    }),
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

test("loads materialized workbench threads through their protocol session id", async () => {
  const loadSessionRequests: unknown[] = [];
  const { client, events } = createClient({
    loadSession: async (request: { sessionId: string }) => {
      loadSessionRequests.push(request);
      return { modes: { currentModeId: "agent", availableModes: [] } };
    },
  });

  const session = await client.loadThread({
    threadId: "thread-1",
    sessionId: "session-1",
    cwd: "C:/repo",
  });

  expect(loadSessionRequests).toEqual([
    {
      sessionId: "session-1",
      cwd: "C:/repo",
      additionalDirectories: undefined,
      mcpServers: [],
    },
  ]);
  expect(session).toEqual({ sessionId: "session-1", cwd: "C:/repo", additionalDirectories: [] });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "session_started",
        thread: { threadId: "thread-1", sessionId: "session-1" },
      }),
    ]),
  );
});

test("loadThread returns a transcript snapshot collected from ACP replay updates", async () => {
  const client = new AcpWorkbenchClient({ clientName: "test", clientVersion: "0.1.0" });
  const events: unknown[] = [];
  client.subscribe((event) => events.push(event));
  client.connect({
    closed: Promise.resolve(),
    signal: new AbortController().signal,
    loadSession: async (request: { sessionId: string }) => {
      await client.sessionUpdate({
        sessionId: request.sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "user-1",
          content: { type: "text", text: "loaded prompt" },
        },
      });
      await client.sessionUpdate({
        sessionId: request.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "assistant-1",
          content: { type: "text", text: "loaded answer" },
        },
      });
      return { modes: { currentModeId: "agent", availableModes: [] } };
    },
    initialize: async (): Promise<InitializeResponse> => ({
      protocolVersion: 1,
      agentInfo: { name: "agent", version: "0.1.0" },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {} },
        providers: {},
      },
    }),
    newSession: async () => ({ sessionId: "session-1" }),
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => undefined,
  });

  const response = await client.loadThread({ threadId: "thread-1", cwd: "C:/repo" });

  expect(response).toEqual({
    session: { sessionId: "thread-1", cwd: "C:/repo", additionalDirectories: [] },
    messages: [
      expect.objectContaining({
        id: "user-1",
        role: "user",
        parts: [expect.objectContaining({ kind: "text", text: "loaded prompt" })],
      }),
      expect.objectContaining({
        id: "assistant-1",
        role: "assistant",
        parts: [expect.objectContaining({ kind: "text", text: "loaded answer" })],
      }),
    ],
  });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "message_part_delta", messageId: "user-1" }),
      expect.objectContaining({ type: "message_part_delta", messageId: "assistant-1" }),
    ]),
  );
});

test("loadThread prefers a Pe workbench snapshot extension over ACP replay capture", async () => {
  const extCalls: unknown[] = [];
  const loadSessionRequests: unknown[] = [];
  const { client } = createClient({
    initialize: async () =>
      ({
        protocolVersion: 1,
        agentInfo: { name: "agent", version: "0.1.0" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { resume: {} },
          _meta: peWorkbenchMetadata(
            createPeWorkbenchExtension({
              capabilities: { historySnapshots: true },
            }),
          ),
        },
      }) satisfies Awaited<ReturnType<Agent["initialize"]>>,
    loadSession: async (request: { sessionId: string }) => {
      loadSessionRequests.push(request);
      return { modes: { currentModeId: "agent", availableModes: [] } };
    },
    extMethod: async (method, params) => {
      extCalls.push({ method, params });
      if (method !== peWorkbenchLoadThreadMethod) return {};
      return {
        session: {
          sessionId: "session-1",
          cwd: "C:/repo",
          additionalDirectories: [],
          title: "Loaded from kernel",
        },
        messages: [
          {
            id: "kernel-user-1",
            role: "user",
            parts: [{ kind: "text", text: "from kernel" }],
            status: "complete",
            provenance: {
              source: "runtime",
              protocol: "acp",
              sessionId: "session-1",
              threadId: "thread-1",
              messageId: "kernel-user-1",
            },
          },
        ],
        events: [
          {
            type: "plan_replaced",
            entries: [{ id: "plan:0", content: "Inspect active view", status: "completed" }],
          },
        ],
      };
    },
  });
  await client.initialize();

  const response = await client.loadThread({
    threadId: "thread-1",
    sessionId: "session-1",
    cwd: "C:/repo",
  });

  expect(response).toEqual({
    session: {
      sessionId: "session-1",
      cwd: "C:/repo",
      additionalDirectories: [],
      title: "Loaded from kernel",
    },
    messages: [
      {
        id: "kernel-user-1",
        role: "user",
        parts: [{ kind: "text", text: "from kernel" }],
        status: "complete",
        provenance: {
          source: "runtime",
          protocol: "acp",
          sessionId: "session-1",
          threadId: "thread-1",
          messageId: "kernel-user-1",
        },
      },
    ],
    events: [
      {
        type: "plan_replaced",
        entries: [{ id: "plan:0", content: "Inspect active view", status: "completed" }],
      },
    ],
  });
  expect(loadSessionRequests).toEqual([]);
  expect(extCalls).toEqual([
    {
      method: peWorkbenchLoadThreadMethod,
      params: {
        sessionId: "session-1",
        cwd: "C:/repo",
        additionalDirectories: undefined,
      },
    },
  ]);
});

test("resolves approval requests by stable session/tool key", async () => {
  const { client, events } = createClient();
  const responsePromise = client.requestPermission({
    sessionId: "session-1",
    toolCall: { toolCallId: "tool-1", title: "Edit", status: "pending" },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  });

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
  });

  await client.close();

  await expect(responsePromise).resolves.toEqual({ outcome: { outcome: "cancelled" } });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "approval_resolved", requestId: "session-1:tool-1" }),
    ]),
  );
});

test("queues messages through the workbench ACP extension", async () => {
  const calls: unknown[] = [];
  const { client } = createClient({
    extMethod: async (method, params) => {
      calls.push({ method, params });
      return { queued: true };
    },
  });

  await expect(
    client.queueMessage({
      sessionId: "session-1",
      text: "hello",
    }),
  ).resolves.toEqual({
    accepted: true,
    queued: true,
  });
  expect(calls).toEqual([
    {
      method: peWorkbenchQueueMessageMethod,
      params: {
        sessionId: "session-1",
        prompt: [{ type: "text", text: "hello" }],
      },
    },
  ]);
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

test("sets model and access level through workbench ACP extensions", async () => {
  const calls: unknown[] = [];
  const { client, events } = createClient({
    extMethod: async (method, params) => {
      calls.push({ method, params });
      if (method === peWorkbenchSetModelMethod) {
        return { currentModelId: "openai/gpt-5.5", accessLevel: "trusted" };
      }
      if (method === peWorkbenchSetAccessLevelMethod) {
        return {
          accessLevel: "ask",
          accessLevels: [{ id: "ask", name: "Ask" }],
        };
      }
      return {};
    },
  });

  await client.newSession({ cwd: "C:/repo" });
  await client.setModel("openai/gpt-5.5");
  await client.setAccessLevel("ask");

  expect(calls).toEqual([
    {
      method: peWorkbenchSetModelMethod,
      params: { sessionId: "session-1", modelId: "openai/gpt-5.5" },
    },
    {
      method: peWorkbenchSetAccessLevelMethod,
      params: { sessionId: "session-1", accessLevel: "ask" },
    },
  ]);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "model_state_updated",
        model: { currentModelId: "openai/gpt-5.5" },
      }),
      expect.objectContaining({
        type: "access_level_updated",
        access: {
          currentAccessLevel: "ask",
          availableAccessLevels: [{ id: "ask", name: "Ask", metadata: undefined }],
        },
      }),
    ]),
  );
});

test("drives in-process ACP client over linked streams", async () => {
  const client = createInProcessAcpWorkbenchClient(
    (): Agent => ({
      initialize: async (_params) =>
        ({
          protocolVersion: 1,
          agentInfo: { name: "agent", version: "0.1.0" },
          agentCapabilities: { sessionCapabilities: { list: {} }, providers: {} },
        }) satisfies Awaited<ReturnType<Agent["initialize"]>>,
      newSession: async () => ({ sessionId: "session-1" }),
      listSessions: async (_params) => ({
        sessions: [{ sessionId: "session-1", title: "Current", cwd: "C:/repo" }],
      }),
      authenticate: async () => undefined,
      prompt: async () => ({ stopReason: "end_turn" }),
      cancel: async () => undefined,
    }),
  );

  await expect(client.initialize()).resolves.toEqual(expect.objectContaining({ name: "agent" }));
  await expect(client.newSession({ cwd: "C:/repo" })).resolves.toEqual(
    expect.objectContaining({ sessionId: "session-1" }),
  );
  await expect(client.listThreads("C:/repo")).resolves.toEqual([
    expect.objectContaining({ threadId: "session-1", title: "Current" }),
  ]);
  await expect(client.sendPrompt({ sessionId: "session-1", text: "hello" })).resolves.toEqual({
    stopReason: "end_turn",
  });
});
