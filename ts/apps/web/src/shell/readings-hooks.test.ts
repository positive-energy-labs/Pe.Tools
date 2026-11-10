// Step 5 R: a shell hook subject (route target, host status, provider) runs the same source-attempt
// lifecycle as admitted route readings (`openSourceReading`), never a second reading engine.
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Reading } from "@pe/agent-contracts";

const { readingAtom, inventoryOf } = await import("../host/resource-state");

afterEach(() => vi.useRealTimers());

function transport() {
  const listeners = new Set<(frame: unknown) => void>();
  const counts = { opened: 0, closed: 0 };
  return {
    counts,
    source: {
      subscribe(_request: unknown, listener: (frame: unknown) => void) {
        counts.opened++;
        listeners.add(listener);
        return () => {
          counts.closed++;
          listeners.delete(listener);
        };
      },
    } as never,
    send: (frame: unknown) => listeners.forEach((listener) => listener(frame)),
  };
}

function watch(source: never, kind: "world" | "inventory" = "world") {
  const registry = AtomRegistry.make();
  const atom = readingAtom({ kind }, source);
  let last: Reading<unknown> = { state: "absent" };
  const stop = registry.subscribe(atom, (reading) => (last = reading), { immediate: true });
  return { read: () => last, stop };
}

test("a hook subject keeps evidence through stale and gap, holds a failure until an answer, releases once", async () => {
  const t = transport();
  const w = watch(t.source);
  expect(w.read().state).toBe("loading");
  t.send({ kind: "snapshot", value: { a: 1 }, changed: true });
  expect(w.read()).toEqual({ state: "ready", observation: { a: 1 }, changed: true });
  t.send({ kind: "stale" });
  expect(w.read()).toEqual({ state: "stale", previous: { a: 1 }, reason: "disconnected" });
  t.send({ kind: "gap" });
  expect(w.read()).toEqual({ state: "stale", previous: { a: 1 }, reason: "gap" });
  t.send({ kind: "failure", error: "boom" });
  expect(w.read()).toMatchObject({ state: "failed", message: "boom", previous: { a: 1 } });
  t.send({ kind: "stale" });
  expect(w.read().state).toBe("failed");
  t.send({ kind: "snapshot", value: { a: 2 } });
  expect(w.read()).toEqual({ state: "ready", observation: { a: 2 } });
  w.stop();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(t.counts).toEqual({ opened: 1, closed: 1 });
});

test("a silent hook subject fails at its deadline; one holding evidence goes stale instead", async () => {
  vi.useFakeTimers();
  const silent = transport();
  const a = watch(silent.source);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(a.read()).toMatchObject({
    state: "failed",
    message: expect.stringContaining("sent no answer"),
  });
  const held = transport();
  const b = watch(held.source);
  held.send({ kind: "snapshot", value: { a: 1 }, stale: true });
  expect(b.read()).toEqual({ state: "stale", previous: { a: 1 }, reason: "disconnected" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(b.read()).toEqual({ state: "stale", previous: { a: 1 }, reason: "disconnected" });
  held.send({ kind: "snapshot", value: { a: 3 } });
  expect(b.read()).toEqual({ state: "ready", observation: { a: 3 } });
  a.stop();
  b.stop();
});

test("a synchronous cached answer stays current past the initial silence deadline", async () => {
  vi.useFakeTimers();
  const source = {
    subscribe(_request: unknown, listener: (frame: unknown) => void) {
      listener({ kind: "snapshot", value: { a: 1 } });
      return () => {};
    },
  } as never;
  const w = watch(source);
  expect(w.read()).toEqual({ state: "ready", observation: { a: 1 } });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(w.read()).toEqual({ state: "ready", observation: { a: 1 } });
  w.stop();
});

test("inventory decodes at the hook boundary and retains truthful evidence on malformed observations", () => {
  const t = transport();
  const w = watch(t.source, "inventory");
  const value = {
    sessions: [
      {
        sessionId: "recorded-session",
        connected: true,
        openDocumentCount: 0,
        openDocuments: null,
        processId: null,
        custody: null,
      },
    ],
  };
  t.send({ kind: "snapshot", value });
  expect(w.read()).toEqual({ state: "ready", observation: value });
  expect(inventoryOf(value.sessions)[0]).toMatchObject({ processId: null, custody: null });
  expect(() =>
    t.send({ kind: "snapshot", value: { sessions: [{ connected: "yes" }] } }),
  ).not.toThrow();
  expect(w.read()).toMatchObject({ state: "failed", previous: value });
  t.send({ kind: "snapshot", value });
  expect(w.read()).toEqual({ state: "ready", observation: value });
  w.stop();
});
