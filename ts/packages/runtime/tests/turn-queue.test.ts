import { expect, test, vi } from "vite-plus/test";
import { type Session } from "@mastra/core/agent-controller";
import { installTurnQueue, turnQueues } from "../src/turn-queue.ts";
import type { ScopeStore } from "../src/scope-store.ts";

function fixture(stored: unknown[] = []) {
  let running = true;
  let listener: (event: any) => void = () => {};
  let head = { defaultTarget: null, revision: 1 };
  // Stands in for `admitTurn`, which refuses a queued head that no longer matches.
  const emit = vi.fn();
  const send = vi.fn(async (input: any) => {
    const queued = input.requestContext?.get("peaQueuedHead");
    if (queued && queued.revision !== head.revision)
      throw new Error("Queued message paused because the thread target changed.");
    running = true;
  });
  const session = {
    sendMessage: send,
    // Mastra's steer aborts, then sends through the session's own (wrapped) sendMessage.
    steer: vi.fn(async function (this: Session, input: any) {
      await this.sendMessage(input);
    }),
    subscribe: (fn: typeof listener) => {
      listener = fn;
      return () => {};
    },
    emit,
    suspensions: { hasPending: () => false },
    thread: { requireId: () => "thread", getId: () => "thread" },
    run: { isRunning: () => running },
  } as unknown as Session;
  const queues = new Map([["thread", stored]]);
  const ready = installTurnQueue(session, {
    read: async () => head,
    readQueue: async (thread: string) => queues.get(thread) ?? [],
    writeQueue: async (thread: string, items: unknown[]) => void queues.set(thread, items),
  } as unknown as ScopeStore).ready;
  const queue = turnQueues.get(session)!;
  return {
    ready,
    stored: () => queues.get("thread"),
    session,
    send,
    emit,
    queue,
    count: () => queue.read().items.length,
    fire: (event: any) => listener(event),
    changeTarget: () => {
      head = { ...head, revision: 2 };
    },
    end: (reason: string) => {
      running = false;
      listener({ type: "agent_end", reason });
    },
  };
}

test("active sends wait FIFO, preserve attachments, and dispatch only once", async () => {
  const f = fixture();
  const first = {
    content: "first",
    files: [{ data: "data:text/plain;base64,YQ==", mediaType: "text/plain" }],
  };
  await Promise.all([f.session.sendMessage(first), f.session.sendMessage({ content: "second" })]);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.count()).toBe(2);
  expect(f.emit).toHaveBeenLastCalledWith({ type: "follow_up_queued", count: 2 });
  f.end("complete");
  await Promise.all([f.session.drainFollowUpQueue(), f.session.drainFollowUpQueue()]);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send).toHaveBeenCalledWith(expect.objectContaining(first));
  f.end("complete");
  await f.session.drainFollowUpQueue();
  expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ content: "second" }));
  expect(f.count()).toBe(0);
});

for (const reason of ["suspended", "aborted", "error"]) {
  test(`${reason} retains the queue without dispatching`, async () => {
    const f = fixture();
    await f.session.sendMessage({ content: "later" });
    f.end(reason);
    expect(await f.session.drainFollowUpQueue()).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.count()).toBe(1);
  });
}

test("target changes and admission failures retain the message", async () => {
  const f = fixture();
  await f.session.sendMessage({ content: "later" });
  f.changeTarget();
  f.end("complete");
  expect(await f.session.drainFollowUpQueue()).toBe(false);
  expect(f.count()).toBe(1);
  expect(f.queue.read()).toMatchObject({
    paused: true,
    error: "Queued message paused because the thread target changed.",
  });
  const g = fixture();
  await g.session.sendMessage({ content: "later" });
  g.send.mockRejectedValueOnce(new Error("refused"));
  g.end("complete");
  expect(await g.session.drainFollowUpQueue()).toBe(false);
  expect(g.count()).toBe(1);
});

test("resume after a target change dispatches against the current target", async () => {
  const f = fixture();
  await f.session.sendMessage({ content: "later" });
  f.end("aborted");
  f.changeTarget();
  await f.queue.change({ action: "resume" });
  expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: "later" }));
  expect(f.send.mock.calls[0]![0].requestContext.get("peaQueuedHead")).toEqual({
    defaultTarget: null,
    revision: 2,
  });
  expect(f.queue.read()).toEqual({ items: [], paused: false, error: undefined });
});

for (const clear of ["thread_created", "steer"]) {
  test(`a Mastra-side ${clear} clear leaves no queued ghost to edit or dispatch`, async () => {
    const f = fixture();
    await f.session.sendMessage({ content: "ghost" });
    const [ghost] = f.queue.read().items;
    if (clear === "steer") await f.session.steer({ content: "now" });
    else f.fire({ type: "thread_created", thread: { id: "other" } });
    expect(f.queue.read().items).toEqual([]);
    await expect(f.queue.change({ action: "edit", id: ghost!.id, content: "x" })).rejects.toThrow(
      "already left",
    );
    f.end("complete");
    expect(await f.session.drainFollowUpQueue()).toBe(false);
    expect(f.send).not.toHaveBeenCalledWith(expect.objectContaining({ content: "ghost" }));
  });
}

test("real Mastra session admits the queued message as a separate turn after completion", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDeterministicRuntime } = await import("../src/testing.ts");
  const { readThreadState } = await import("../src/thread-state.ts");
  const runtime = await createDeterministicRuntime({
    databasePath: join(await mkdtemp(join(tmpdir(), "pea-queue-")), "pea.sqlite"),
    resourceId: "queue-proof",
    peaWeb: true,
    responses: [{ text: "first answer", finishDelayMs: 1000 }, { text: "second answer" }],
  });
  try {
    const session = await runtime.controller.createSession({
      resourceId: "queue-proof",
      scope: "q",
      threadId: "q",
    });
    const ends: string[] = [];
    const done = new Promise<void>((resolve) =>
      session.subscribe((event) => {
        if (event.type === "agent_end") {
          ends.push(event.reason ?? "unknown");
          if (ends.length === 2) resolve();
        }
      }),
    );
    await session.sendMessage({ content: "first" });
    await session.sendMessage({ content: "second" });
    expect(turnQueues.get(session)!.read().items).toHaveLength(1);
    expect(session.followUps.count()).toBe(0);
    expect(session.displayState.get().queuedFollowUps).toBe(1);
    expect(ends).toEqual([]);
    await done;
    expect(ends).toEqual(["complete", "complete"]);
    expect(turnQueues.get(session)!.read().items).toEqual([]);
    const state = await readThreadState(runtime, session, "q");
    expect(JSON.stringify(state.messages)).toContain("second answer");
  } finally {
    await runtime.close?.();
  }
}, 20000);

test("paused messages can be edited, removed, and explicitly resumed", async () => {
  const f = fixture();
  await f.session.sendMessage({ content: "one" });
  await f.session.sendMessage({ content: "two" });
  f.end("aborted");
  const [first, second] = f.queue.read().items;
  await f.queue.change({ action: "edit", id: first!.id, content: "changed" });
  await f.queue.change({ action: "remove", id: second!.id });
  expect(f.queue.read().paused).toBe(true);
  await f.queue.change({ action: "resume" });
  expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: "changed" }));
  expect(f.queue.read().items).toEqual([]);
  await expect(f.queue.change({ action: "remove", id: first!.id })).rejects.toThrow("already left");
});

test("a new Enter after a cancel sends at once while the paused queue stays paused", async () => {
  const f = fixture();
  await f.session.sendMessage({ content: "parked" });
  f.end("aborted");
  await f.session.sendMessage({ content: "fresh" });
  expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: "fresh" }));
  expect(f.queue.read()).toMatchObject({ items: [{ content: "parked" }], paused: true });
  f.end("complete");
  expect(await f.session.drainFollowUpQueue()).toBe(false);
  expect(f.queue.read()).toMatchObject({ items: [{ content: "parked" }], paused: true });
});

test("steer dispatches past the run it cancels, even before that run has ended", async () => {
  const f = fixture();
  await f.session.steer({ content: "instead" });
  expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: "instead" }));
  expect(f.queue.read().items).toEqual([]);
});

test("the queue persists beside the thread and a mid-dispatch item returns paused", async () => {
  const f = fixture();
  await f.session.sendMessage({ content: "kept" });
  expect(f.stored()).toMatchObject([{ content: "kept", dispatching: false }]);
  f.send.mockImplementationOnce(() => new Promise(() => {}));
  f.end("complete");
  void f.session.drainFollowUpQueue();
  await vi.waitFor(() => expect(f.send).toHaveBeenCalled());
  const restarted = fixture(f.stored());
  await restarted.ready;
  expect(restarted.queue.read()).toMatchObject({
    items: [{ content: "kept" }],
    paused: true,
    error: expect.stringContaining("may already have received"),
  });
  restarted.end("complete");
  expect(await restarted.session.drainFollowUpQueue()).toBe(false);
  expect(restarted.send).not.toHaveBeenCalled();
});

test("real Mastra: a retry after a post-delivery failure saves the user message once", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDeterministicRuntime } = await import("../src/testing.ts");
  const runtime = await createDeterministicRuntime({
    databasePath: join(await mkdtemp(join(tmpdir(), "pea-retry-")), "pea.sqlite"),
    resourceId: "retry-proof",
    peaWeb: true,
    responses: [{ text: "first answer", finishDelayMs: 500 }, { text: "a" }, { text: "b" }],
  });
  try {
    const session = await runtime.controller.createSession({
      resourceId: "retry-proof",
      scope: "r",
      threadId: "r",
    });
    const ends: string[] = [];
    session.subscribe((event) => {
      if (event.type === "agent_end") ends.push(event.reason ?? "unknown");
    });
    await session.sendMessage({ content: "first" });
    await session.sendMessage({ content: "second" });
    // The signal is delivered and saved, then admission reports failure: the ambiguous case.
    const sendSignal = session.sendSignal.bind(session);
    session.sendSignal = ((input: any, options: any) => {
      session.sendSignal = sendSignal;
      const signal = sendSignal(input, options);
      return { ...signal, accepted: signal.accepted.then(() => Promise.reject(new Error("lost"))) };
    }) as typeof session.sendSignal;
    const queue = turnQueues.get(session)!;
    await vi.waitFor(() => expect(queue.read().error).toBe("lost"), 10000);
    await vi.waitFor(() => expect(ends.length).toBeGreaterThanOrEqual(2), 10000);
    // A paused queue needs the explicit resume; one that retried on completion already has.
    if (ends.length === 2) await queue.change({ action: "resume" });
    await vi.waitFor(() => expect(ends).toHaveLength(3), 10000);
    expect(queue.read().items).toEqual([]);
    const all = await runtime.controller.queryThreadMessages({ threadId: "r" });
    const saved = all.filter(
      (message) => message.role === "signal" && JSON.stringify(message.content).includes("second"),
    );
    expect(saved).toHaveLength(1);
  } finally {
    await runtime.close?.();
  }
}, 30000);

test("real Mastra: a queued message survives a restart over the same database, paused", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDeterministicRuntime } = await import("../src/testing.ts");
  const databasePath = join(await mkdtemp(join(tmpdir(), "pea-restart-")), "pea.sqlite");
  const open = (responses: { text: string; finishDelayMs?: number }[]) =>
    createDeterministicRuntime({ databasePath, resourceId: "restart", peaWeb: true, responses });
  const input = { resourceId: "restart", scope: "s", threadId: "s" };
  const before = await open([{ text: "slow", finishDelayMs: 5000 }]);
  const session = await before.controller.createSession(input);
  await session.sendMessage({ content: "first" });
  await session.sendMessage({ content: "survivor" });
  await before.close?.();
  const after = await open([{ text: "never" }]);
  try {
    const queue = turnQueues.get(await after.controller.createSession(input))!;
    await vi.waitFor(() => expect(queue.read().items).toHaveLength(1));
    expect(queue.read()).toMatchObject({ items: [{ content: "survivor" }], paused: true });
  } finally {
    await after.close?.();
  }
}, 30000);
