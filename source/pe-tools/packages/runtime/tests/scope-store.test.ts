import { expect, test, vi } from "vite-plus/test";
import type { Session } from "@mastra/core/agent-controller";
import { buildAgentControllerApp } from "../src/agent-controller-web.ts";
import { createDeterministicRuntime } from "../src/testing.ts";
import { admitTurn, ScopeStore, type ScopeStateStore } from "../src/scope-store.ts";
import { turnContextKey, type Turn } from "@pe/agent-contracts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function memoryStore(): ScopeStateStore {
  const state = new Map<string, unknown>();
  return {
    getState: async ({ type }) => state.get(type),
    setState: async ({ type, value }) => void state.set(type, value),
  };
}

test("same-revision scope writes admit exactly one winner", async () => {
  let value: unknown;
  let reads = 0;
  const firstRead = deferred();
  const releaseFirst = deferred();
  const store: ScopeStateStore = {
    getState: async () => {
      const snapshot = value;
      if (++reads === 1) {
        firstRead.resolve();
        await releaseFirst.promise;
      }
      return snapshot;
    },
    setState: async (input) => {
      value = input.value;
    },
  };
  const scopes = new ScopeStore(async () => store, "resource");

  const writes = Promise.all([
    scopes.set("thread", { kind: "open", ref: { session: "s", openId: "first" } }, 0),
    scopes.set("thread", { kind: "open", ref: { session: "s", openId: "second" } }, 0),
  ]);
  await firstRead.promise;
  releaseFirst.resolve();
  const results = await writes;

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => result.why === "stale")).toHaveLength(1);
});

test("admission orders scope writes without blocking other threads", async () => {
  const store = memoryStore();
  const scopes = new ScopeStore(async () => store, "resource");
  const gate = deferred();
  let running = false;
  const admission = scopes.admit("A", "turn", async () => {
    await gate.promise;
    running = true;
  });
  const refused = scopes.set("A", null, 0, () =>
    running || scopes.admissionPending("A") ? { ok: false, why: "in-turn" } : undefined,
  );

  await expect(scopes.set("B", null, 0)).resolves.toMatchObject({ ok: true });
  gate.resolve();
  await admission;
  await expect(refused).resolves.toEqual({ ok: false, why: "in-turn" });
});

test("failed concurrent admission restores the accepted turn and releases pending state", async () => {
  const store = memoryStore();
  const scopes = new ScopeStore(async () => store, "resource");
  const first = deferred();
  const second = deferred();
  const firstSent = deferred();
  const secondSent = deferred();
  let sends = 0;
  const session = {
    thread: { requireId: () => "thread" },
    sendSignal: () => {
      sends++;
      (sends === 1 ? firstSent : secondSent).resolve();
      return { accepted: sends === 1 ? first.promise : second.promise };
    },
  } as unknown as Session;

  const accepted = admitTurn(scopes, session, { content: "first" });
  const rejected = admitTurn(scopes, session, { content: "second" });
  await firstSent.promise;
  expect(sends).toBe(1);
  const firstTurn = scopes.admittedTurn("thread");

  first.resolve();
  await accepted;
  await secondSent.promise;
  expect(sends).toBe(2);
  second.reject(new Error("rejected"));
  await expect(rejected).rejects.toThrow("rejected");
  expect(scopes.admissionPending("thread")).toBe(false);
  expect(scopes.admittedTurn("thread")).toBe(firstTurn);
});

test("failed signal delivery releases admission state", async () => {
  const store = memoryStore();
  const scopes = new ScopeStore(async () => store, "resource");
  const delivery = deferred();
  const sent = deferred();
  const session = {
    thread: { requireId: () => "thread" },
    sendSignal: (_input: unknown, options?: { requireDelivery?: boolean }) => {
      sent.resolve();
      return {
        accepted: options?.requireDelivery
          ? delivery.promise
          : Promise.resolve({ accepted: true as const }),
      };
    },
  } as unknown as Session;

  const admission = admitTurn(scopes, session, { content: "message" });
  await sent.promise;
  expect(scopes.admissionPending("thread")).toBe(true);
  delivery.reject(new Error("delivery failed"));
  await expect(admission).rejects.toThrow("delivery failed");
  expect(scopes.admissionPending("thread")).toBe(false);
  expect(scopes.admittedTurn("thread")).toBeUndefined();
  await expect(scopes.set("thread", null, 0)).resolves.toMatchObject({ ok: true });
});

test("scope PUT fences running writes and applies an approved proposal only to future turns", async () => {
  const runtime = await createDeterministicRuntime({
    databasePath: ":memory:",
    resourceId: "scope-http",
    responses: [{ text: "unused" }],
  });
  try {
    const app = await buildAgentControllerApp({ runtime, label: "pea" });
    const put = (body: unknown) =>
      app.fetch(
        new Request("http://local/pe/scope/thread", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const first = { kind: "open", ref: { session: "s", openId: "first" } } as const;
    const second = { kind: "open", ref: { session: "s", openId: "second" } } as const;
    expect((await put({ defaultTarget: first, expectedRevision: 0 })).status).toBe(200);
    const session = await runtime.controller.createSession({
      resourceId: runtime.resourceId,
      scope: "thread",
      threadId: "thread",
    });
    const isRunning = vi.spyOn(session.run, "isRunning").mockReturnValue(true);

    expect((await put({ defaultTarget: second, expectedRevision: 1 })).status).toBe(409);

    const turns: Turn[] = [];
    const contextTurns: Turn[] = [];
    vi.spyOn(session, "sendSignal").mockImplementation(((input, options) => {
      const turn = (input as { metadata?: { turn?: Turn } }).metadata?.turn;
      if (!turn) throw new Error("missing turn metadata");
      const requestContext = options?.requestContext;
      if (!requestContext) throw new Error("missing turn request context");
      turns.push(turn);
      contextTurns.push((requestContext as { get(key: string): Turn }).get(turnContextKey));
      return {
        id: turn.id,
        type: "user",
        accepted: Promise.resolve({ accepted: true as const }),
      };
    }) as typeof session.sendSignal);
    await admitTurn(runtime.scopes, session, { content: "run" });
    const approvedTurn = turns[0].id;

    expect(
      (await put({ defaultTarget: second, expectedRevision: 1, turn: crypto.randomUUID() })).status,
    ).toBe(409);
    expect(
      (await put({ defaultTarget: second, expectedRevision: 1, turn: approvedTurn })).status,
    ).toBe(200);
    expect(turns[0]).toMatchObject({ defaultTarget: first, revision: 1 });
    expect(contextTurns[0]).toEqual(turns[0]);
    expect(await runtime.scopes.read("thread")).toMatchObject({
      defaultTarget: second,
      revision: 2,
    });
    isRunning.mockReturnValue(false);
    await admitTurn(runtime.scopes, session, { content: "next" });
    expect(turns[0]).toMatchObject({ defaultTarget: first, revision: 1 });
    expect(turns[1]).toMatchObject({ defaultTarget: second, revision: 2 });
    expect(contextTurns[1]).toEqual(turns[1]);
  } finally {
    await runtime.close?.();
  }
});

test("admission queued behind a scope write freezes the landed head", async () => {
  let value: unknown;
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const store: ScopeStateStore = {
    getState: async () => value,
    setState: async (input) => {
      writeStarted.resolve();
      await releaseWrite.promise;
      value = input.value;
    },
  };
  const scopes = new ScopeStore(async () => store, "resource");
  let frozenRevision: number | undefined;
  const session = {
    thread: { requireId: () => "thread" },
    sendSignal: (input: { metadata?: { turn?: { revision: number } } }) => {
      frozenRevision = input.metadata?.turn?.revision;
      return { accepted: Promise.resolve({ accepted: true as const }) };
    },
  } as unknown as Session;

  const write = scopes.set("thread", null, 0);
  await writeStarted.promise;
  const admission = admitTurn(scopes, session, { content: "after write" });
  releaseWrite.resolve();
  await Promise.all([write, admission]);
  expect(frozenRevision).toBe(1);
});
