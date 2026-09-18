import { expect, test } from "vite-plus/test";
import type { Session } from "@mastra/core/agent-controller";
import { admitTurn, ScopeStore, type ScopeStateStore } from "../src/scope-store.ts";

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
