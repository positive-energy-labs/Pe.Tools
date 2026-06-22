import os from "node:os";
import path from "node:path";
import type { NewSessionRequest, PromptRequest } from "@agentclientprotocol/sdk";
import type { HarnessEvent } from "@mastra/core/harness";
import type { RequestContext } from "@mastra/core/request-context";
import {
  peWorkbenchLoadThreadMethod,
  readWorkbenchLoadThreadResponse,
  type WorkbenchMessage,
  type WorkbenchMessagePart,
} from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import {
  RuntimeProtocolSessions,
  ThreadLockError,
  createRuntimeHarness,
  createRuntimeDescriptor,
  createRuntimeAcpAgent,
  createRuntimeFactory,
  createRuntimeKernel,
  getRuntimeResumeDecisions,
  type RuntimeCreateRequest,
  type RuntimeFactory,
  type RuntimeFactoryOptions,
  type RuntimeHandle,
  type RuntimeHandleServices,
  type RuntimeInjectedHarnessConfig,
  type RuntimeThreadStateStore,
} from "../src/index.ts";

test("runtime history is empty for drafts and records the prompt once materialized", async () => {
  const manager = new RuntimeProtocolSessions({
    factory: createKernelRuntimeFactory(),
    defaultCwd: testCwd(),
  });
  const session = await manager.createSession({
    protocol: "acp",
    cwd: testCwd(),
    title: "Draft session",
  });

  expect(manager.history(session.id)).toEqual([]);

  await manager.sendPrompt(session.id, { content: "materialize this session" });

  expect(manager.history(session.id)).toContainEqual(
    expect.objectContaining({ type: "prompt", content: "materialize this session" }),
  );
});

test("kernel ledger replays the same user and assistant transcript through ACP workbench snapshots", async () => {
  const updates: unknown[] = [];
  const factory = createKernelRuntimeFactory({
    onSend: (_message, harness) => {
      harness.emitAssistantMessage("assistant-1", "kernel ledger answer");
    },
  });
  const agent = createRuntimeAcpAgent(
    {
      sessionUpdate: (update) => {
        updates.push(update);
      },
    },
    { runtime: { factory } },
  );

  const session = await agent.newSession({
    cwd: testCwd(),
    mcpServers: [],
  } satisfies NewSessionRequest);
  await agent.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "kernel ledger prompt" }],
  } satisfies PromptRequest);

  const snapshot = readWorkbenchLoadThreadResponse(
    await agent.extMethod?.(peWorkbenchLoadThreadMethod, {
      sessionId: session.sessionId,
      cwd: testCwd(),
    }),
  );
  if (!snapshot) throw new Error("Expected workbench load thread snapshot.");

  expect(snapshot.messages?.map(messageSummary)).toEqual([
    { role: "user", text: "kernel ledger prompt" },
    { role: "assistant", text: "kernel ledger answer" },
  ]);
  expect(updates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sessionId: session.sessionId,
        update: expect.objectContaining({ sessionUpdate: "agent_message_chunk" }),
      }),
    ]),
  );
});

test("cancel invalidates queued work and late resume decisions before the next prompt", async () => {
  const harness = new FakeRuntimeHarness();
  const manager = new RuntimeProtocolSessions({
    factory: createKernelRuntimeFactory({ harness }),
    defaultCwd: testCwd(),
  });
  const session = await manager.createSession({
    protocol: "acp",
    cwd: testCwd(),
    title: "Cancelable session",
  });
  let queuedMutationRan = false;

  manager.recordResumeDecision(session.id, {
    interruptId: "tool-approval:before-cancel",
    status: "resolved",
    payload: { optionId: "allow" },
  });
  manager.enqueue(session.id, () => {
    queuedMutationRan = true;
  });

  manager.cancel(session.id);
  await flushAsyncQueue();

  manager.recordResumeDecision(session.id, {
    interruptId: "tool-approval:after-cancel",
    status: "resolved",
    payload: { optionId: "allow" },
  });
  await manager.sendPrompt(session.id, { content: "next prompt" });

  expect(queuedMutationRan).toBe(false);
  expect(getRuntimeResumeDecisions(harness.sentMessages.at(-1)!.requestContext!)).toEqual([]);
});

test("runtime factory opens startup threads only when a surface opts into startup policy", async () => {
  const passiveHarness = new FakeRuntimeHarness();
  const passiveFactory = createKernelRuntimeFactory({ harness: passiveHarness });

  await passiveFactory.create({ protocol: "tui", cwd: testCwd(), workspaceRoot: testCwd() });

  expect(passiveHarness.createThreadCount).toBe(0);
  expect(passiveHarness.getCurrentThreadId()).toBeUndefined();

  const activeHarness = new FakeRuntimeHarness();
  const activeFactory = createKernelRuntimeFactory(
    { harness: activeHarness },
    { startupThread: { enabled: true, createTitle: "Startup thread" } },
  );

  await activeFactory.create({ protocol: "tui", cwd: testCwd(), workspaceRoot: testCwd() });

  expect(activeHarness.createThreadCount).toBe(1);
  expect(activeHarness.getCurrentThreadId()).toBe("thread-1");
});

test("runtime startup selection skips locked threads and opens the next valid thread", async () => {
  const harness = new FakeRuntimeHarness({
    threads: [
      fakeThread("thread-locked", "2026-06-17T14:00:00.000Z"),
      fakeThread("thread-valid", "2026-06-17T13:00:00.000Z"),
    ],
    lockedThreadIds: ["thread-locked"],
  });
  const opened: Array<{
    status: string;
    threadId: string;
    lockedThreadIds: string[];
  }> = [];
  const factory = createKernelRuntimeFactory(
    { harness },
    {
      startupThread: {
        enabled: true,
        onThreadOpened({ selection }) {
          opened.push({
            status: selection.status,
            threadId: selection.threadId,
            lockedThreadIds: selection.lockedThreadIds,
          });
        },
      },
    },
  );

  await factory.create({ protocol: "tui", cwd: testCwd(), workspaceRoot: testCwd() });

  expect(harness.switchThreadRequests).toEqual(["thread-locked", "thread-valid"]);
  expect(harness.createThreadCount).toBe(0);
  expect(harness.getCurrentThreadId()).toBe("thread-valid");
  expect(opened).toEqual([
    { status: "selected", threadId: "thread-valid", lockedThreadIds: ["thread-locked"] },
  ]);
});

test("kernel resume rejects illegal moves before switching harness threads", async () => {
  const harness = new FakeRuntimeHarness({
    threads: [
      fakeThread("thread-1", "2026-06-17T13:00:00.000Z"),
      fakeThread("thread-2", "2026-06-17T14:00:00.000Z"),
    ],
  });
  const kernel = createRuntimeKernel(harness);

  await kernel.resumeThreadSession({
    sessionId: "session-1",
    threadId: "thread-1",
    protocol: "acp",
  });

  await expect(
    kernel.resumeThreadSession({
      sessionId: "session-1",
      threadId: "thread-2",
      protocol: "acp",
    }),
  ).rejects.toThrow("cannot move session session-1 from thread thread-1 to thread thread-2");

  expect(harness.getCurrentThreadId()).toBe("thread-1");
  expect(harness.switchThreadRequests).toEqual(["thread-1"]);
});

test("runtime harness close releases locks and closes storage when ledger flush fails", async () => {
  const harness = new FakeRuntimeHarness();
  const thread = await harness.createThread({ title: "Flush failure" });
  let releasedThreadId: string | undefined;
  let storageClosed = false;
  const config: RuntimeInjectedHarnessConfig = {
    storage: {
      close: async () => {
        storageClosed = true;
      },
    },
    threadLock: {
      release: (threadId: string) => {
        releasedThreadId = threadId;
      },
    },
  };
  const threadStateStore: RuntimeThreadStateStore = {
    getState: async () => undefined,
    setState: async () => {
      throw new Error("flush failed");
    },
  };
  const runtime = await createRuntimeHarness({
    config,
    harness,
    sessionOptions: {
      threadStateStore,
    },
  });

  runtime.kernel.recordProtocolEvent({
    threadId: thread.id,
    resourceId: thread.resourceId,
    protocol: "acp",
    payload: { event: "persist me" },
  });

  await expect(runtime.close?.()).rejects.toThrow("flush failed");
  expect(releasedThreadId).toBe(thread.id);
  expect(storageClosed).toBe(true);
});

function createKernelRuntimeFactory(
  options: {
    harness?: FakeRuntimeHarness;
    onSend?: RuntimeSendObserver;
  } = {},
  factoryOptions?: RuntimeFactoryOptions<
    Record<string, unknown>,
    RuntimeHandleServices,
    FakeRuntimeHarness
  >,
): RuntimeFactory<Record<string, unknown>, RuntimeHandleServices, FakeRuntimeHarness> {
  return createRuntimeFactory<Record<string, unknown>, RuntimeHandleServices, FakeRuntimeHarness>(
    createRuntimeDescriptor("test-runtime", {
      modeName: "Test",
      agentName: "Test Agent",
    }),
    async (request) => createKernelRuntimeHandle(request, options),
    factoryOptions,
  );
}

function createKernelRuntimeHandle(
  request: RuntimeCreateRequest,
  options: {
    harness?: FakeRuntimeHarness;
    onSend?: RuntimeSendObserver;
  },
): RuntimeHandle<Record<string, unknown>, RuntimeHandleServices, FakeRuntimeHarness> {
  const harness = options.harness ?? new FakeRuntimeHarness({ onSend: options.onSend });
  const kernel = createRuntimeKernel(harness);
  return {
    harness,
    kernel,
    workspace: { cwd: request.cwd, root: request.workspaceRoot },
    close: () => undefined,
  };
}

type RuntimeSendMessage = {
  content: string;
  requestContext?: RequestContext;
};
type RuntimeSendObserver = (message: RuntimeSendMessage, harness: FakeRuntimeHarness) => void;

class FakeRuntimeHarness {
  private readonly threads: FakeThread[] = [];
  private readonly lockedThreadIds: Set<string>;
  private readonly subscribers = new Set<(event: HarnessEvent) => void | Promise<void>>();
  private readonly onSend?: RuntimeSendObserver;
  private currentThreadId: string | undefined;
  private state: Record<string, unknown> = {};
  private nextThreadNumber = 1;
  createThreadCount = 0;
  switchThreadRequests: string[] = [];
  sentMessages: RuntimeSendMessage[] = [];

  constructor(
    options: {
      lockedThreadIds?: string[];
      onSend?: RuntimeSendObserver;
      threads?: FakeThread[];
    } = {},
  ) {
    this.onSend = options.onSend;
    this.lockedThreadIds = new Set(options.lockedThreadIds ?? []);
    this.threads.push(...(options.threads ?? []));
  }

  async init(): Promise<void> {}

  getResourceId(): string {
    return "resource-1";
  }

  getCurrentThreadId(): string | undefined {
    return this.currentThreadId;
  }

  async createThread(options: { title?: string } = {}): Promise<FakeThread> {
    this.createThreadCount += 1;
    const now = new Date("2026-06-17T12:00:00.000Z");
    const thread: FakeThread = {
      id: `thread-${this.nextThreadNumber++}`,
      resourceId: this.getResourceId(),
      title: options.title,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };
    this.threads.unshift(thread);
    this.currentThreadId = thread.id;
    return thread;
  }

  async switchThread(options: { threadId: string }): Promise<void> {
    this.switchThreadRequests.push(options.threadId);
    if (this.lockedThreadIds.has(options.threadId)) {
      throw new ThreadLockError(options.threadId, 12345);
    }
    if (!this.threads.some((thread) => thread.id === options.threadId)) {
      throw new Error(`Unknown fake thread: ${options.threadId}`);
    }
    this.currentThreadId = options.threadId;
  }

  async listThreads(): Promise<FakeThread[]> {
    return [...this.threads];
  }

  async sendMessage(message: RuntimeSendMessage): Promise<void> {
    this.sentMessages.push(message);
    this.onSend?.(message, this);
  }

  abort(): void {}

  isRunning(): boolean {
    return false;
  }

  subscribe(listener: (event: HarnessEvent) => void | Promise<void>): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  emitAssistantMessage(messageId: string, text: string): void {
    const createdAt = new Date("2026-06-17T12:00:00.000Z");
    this.emit({
      type: "message_update",
      message: {
        id: messageId,
        role: "assistant",
        content: [{ type: "text", text }],
        createdAt,
      },
    });
    this.emit({
      type: "message_end",
      message: {
        id: messageId,
        role: "assistant",
        content: [{ type: "text", text }],
        createdAt,
        stopReason: "complete",
      },
    });
  }

  emit(event: FakeHarnessEvent): void {
    for (const subscriber of this.subscribers) {
      void subscriber(event);
    }
  }

  getState(): Record<string, unknown> {
    return this.state;
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    this.state = { ...this.state, ...state };
  }

  async setThreadSetting(options: { key: string; value: unknown }): Promise<void> {
    const thread = this.threads.find((candidate) => candidate.id === this.currentThreadId);
    if (!thread) throw new Error("No current thread for fake thread setting.");
    thread.metadata = { ...thread.metadata, [options.key]: options.value };
  }

  async getResolvedMemory(): Promise<{ recall: () => Promise<{ messages: unknown[] }> }> {
    return {
      recall: async () => ({ messages: [] }),
    };
  }
}

interface FakeThread {
  id: string;
  resourceId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

function fakeThread(id: string, updatedAt: string): FakeThread {
  const createdAt = new Date("2026-06-17T12:00:00.000Z");
  return {
    id,
    resourceId: "resource-1",
    title: id,
    createdAt,
    updatedAt: new Date(updatedAt),
    metadata: {},
  };
}

type FakeHarnessEvent = Extract<
  HarnessEvent,
  { type: "message_update" | "message_end" | "agent_start" | "agent_end" }
>;

function messageSummary(message: WorkbenchMessage): { role: string; text: string } {
  return {
    role: message.role,
    text: message.parts.map(partText).filter(Boolean).join(""),
  };
}

function partText(part: WorkbenchMessagePart): string {
  return "text" in part ? part.text : "";
}

function testCwd(): string {
  return path.resolve(os.tmpdir());
}

async function flushAsyncQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
