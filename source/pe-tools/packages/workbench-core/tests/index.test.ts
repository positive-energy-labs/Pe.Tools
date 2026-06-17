import { expect, test } from "vite-plus/test";
import { createWorkbenchController, type WorkbenchAgentClient } from "../src/index.ts";

test("workbench loadThread blocks locked threads before calling the agent client", async () => {
  const client = new FakeWorkbenchClient({
    threads: [
      {
        threadId: "thread-locked",
        sessionId: "session-locked",
        title: "Locked",
        lock: { status: "locked", ownerPid: 123 },
      },
    ],
  });
  const controller = createWorkbenchController(client, { cwd: "C:/repo" });

  await controller.start();

  await expect(controller.loadThread("thread-locked")).rejects.toThrow(
    "Thread thread-locked is locked by PID 123.",
  );
  expect(client.loadThreadRequests.map((request) => request.threadId)).not.toContain(
    "thread-locked",
  );
});

test("workbench loadThread allows the owned current thread and preserves thread identity", async () => {
  const client = new FakeWorkbenchClient({
    threads: [
      {
        threadId: "thread-current",
        sessionId: "session-current",
        title: "Current",
        lock: { status: "owned", ownerPid: process.pid },
      },
    ],
  });
  const controller = createWorkbenchController(client, { cwd: "C:/repo" });

  await controller.start();
  client.loadThreadRequests.length = 0;

  await controller.loadThread("session-current");

  expect(client.loadThreadRequests).toEqual([
    { threadId: "thread-current", sessionId: "session-current" },
  ]);
  expect(controller.getState().threads.activeThreadId).toBe("thread-current");
});

test("workbench queued sends retain one active local user turn while the runtime is running", async () => {
  const client = new FakeWorkbenchClient({
    queueMessage: async () => ({ accepted: true, queued: true }),
  });
  const controller = createWorkbenchController(client, { cwd: "C:/repo" });

  await controller.send("first");
  await controller.send("second");

  const userMessages = controller
    .getState()
    .transcript.messages.filter((message) => message.role === "user");
  expect(userMessages).toHaveLength(1);
  expect(userMessages[0]?.parts.map((part) => ("text" in part ? part.text : "")).join("")).toBe(
    "first\nsecond\n",
  );
  expect(controller.getState().uiStatus.overall.status).toBe("running");
});

class FakeWorkbenchClient implements WorkbenchAgentClient {
  readonly loadThreadRequests: Array<{ threadId: string; sessionId?: string }> = [];
  private readonly handlers = new Set<Parameters<WorkbenchAgentClient["subscribe"]>[0]>();
  private readonly threads: Awaited<ReturnType<NonNullable<WorkbenchAgentClient["listThreads"]>>>;
  private readonly queueMessageImpl: NonNullable<WorkbenchAgentClient["queueMessage"]>;

  constructor(
    options: {
      threads?: Awaited<ReturnType<NonNullable<WorkbenchAgentClient["listThreads"]>>>;
      queueMessage?: NonNullable<WorkbenchAgentClient["queueMessage"]>;
    } = {},
  ) {
    this.threads = options.threads ?? [];
    this.queueMessageImpl =
      options.queueMessage ??
      (async () => ({ accepted: true, queued: false, stopReason: "end_turn" }));
  }

  subscribe(handler: Parameters<WorkbenchAgentClient["subscribe"]>[0]): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async initialize(): Promise<Awaited<ReturnType<WorkbenchAgentClient["initialize"]>>> {
    return {
      name: "fake",
      capabilities: { threads: true, history: true },
    };
  }

  async newSession(
    request: Parameters<WorkbenchAgentClient["newSession"]>[0],
  ): Promise<Awaited<ReturnType<WorkbenchAgentClient["newSession"]>>> {
    return {
      sessionId: "session-current",
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories ?? [],
      title: "Current",
    };
  }

  async sendPrompt(): Promise<Awaited<ReturnType<WorkbenchAgentClient["sendPrompt"]>>> {
    return { stopReason: "end_turn" };
  }

  async queueMessage(
    request: Parameters<NonNullable<WorkbenchAgentClient["queueMessage"]>>[0],
  ): Promise<Awaited<ReturnType<NonNullable<WorkbenchAgentClient["queueMessage"]>>>> {
    return this.queueMessageImpl(request);
  }

  async listThreads(): Promise<
    Awaited<ReturnType<NonNullable<WorkbenchAgentClient["listThreads"]>>>
  > {
    return this.threads;
  }

  async loadThread(
    request: Parameters<NonNullable<WorkbenchAgentClient["loadThread"]>>[0],
  ): Promise<Awaited<ReturnType<NonNullable<WorkbenchAgentClient["loadThread"]>>>> {
    this.loadThreadRequests.push({
      threadId: request.threadId,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    });
    return {
      session: {
        sessionId: request.sessionId ?? request.threadId,
        cwd: request.cwd,
        additionalDirectories: request.additionalDirectories ?? [],
        title: request.threadId,
      },
      messages: [],
    };
  }
}
