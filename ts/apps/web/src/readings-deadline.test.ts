// @vitest-environment jsdom
import { readingKey, type Reading } from "@pe/agent-contracts";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { reportFault } from "#/host/diagnostics";

import { PeReadings, readingAtom } from "./readings";

vi.mock("#/host/diagnostics", () => ({ reportFault: vi.fn() }));

const request = { kind: "machine" } as const;

type FakeSource = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

function setup() {
  const sources: FakeSource[] = [];
  const readings = new PeReadings(() => "http://127.0.0.1:5180/readings", (() => {
    const source: FakeSource = { onopen: null, onmessage: null, onerror: null, close: vi.fn() };
    sources.push(source);
    return source;
  }) as never);
  const registry = AtomRegistry.make();
  const atom = readingAtom(request, readings);
  const seen: Reading<unknown>[] = [];
  const unsubscribe = registry.subscribe(atom, (value) => seen.push(value), { immediate: true });
  return { readings, registry, atom, sources, seen, unsubscribe };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(reportFault).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a host that sends no frame fails the reading after 30 s", async () => {
  const { readings, registry, atom, sources, unsubscribe } = setup();
  await vi.advanceTimersByTimeAsync(0);
  expect(sources).toHaveLength(1);
  expect(registry.get(atom).state).toBe("loading");

  await vi.advanceTimersByTimeAsync(29_000);
  expect(registry.get(atom).state).toBe("loading");

  await vi.advanceTimersByTimeAsync(1_000);
  expect(registry.get(atom)).toEqual({
    state: "failed",
    message: "The host sent no reading in 30 s.",
  });
  // One owner: the typed fact names the subject kind, never the serialized key.
  expect(reportFault).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reportFault).mock.calls[0]![0]).toEqual({
    code: "reading.timeout",
    elapsedMs: 30_000,
    readingKind: "machine",
  });
  expect(console.error).not.toHaveBeenCalled();
  unsubscribe();
  readings.close();
});

test("a lost stream is one fault per outage, not one per reconnect attempt", async () => {
  const { readings, sources, unsubscribe } = setup();
  await vi.advanceTimersByTimeAsync(0);
  sources[0]!.onerror!();
  expect(reportFault).not.toHaveBeenCalled(); // never opened: the deadline owns this silence
  await vi.advanceTimersByTimeAsync(1_000);
  sources[1]!.onopen!();
  sources[1]!.onerror!();
  await vi.advanceTimersByTimeAsync(1_000);
  sources[2]!.onerror!();
  await vi.advanceTimersByTimeAsync(1_000);
  sources[3]!.onerror!();
  expect(reportFault).toHaveBeenCalledTimes(1);
  expect(reportFault).toHaveBeenCalledWith({ code: "stream.failed", streamKind: "readings" });
  unsubscribe();
  readings.close();
});

test("a snapshot before the deadline keeps the reading ready", async () => {
  const { readings, registry, atom, sources, unsubscribe } = setup();
  await vi.advanceTimersByTimeAsync(0);
  expect(registry.get(atom).state).toBe("loading");

  await vi.advanceTimersByTimeAsync(10_000);
  sources[0]!.onmessage!({
    data: JSON.stringify({ kind: "snapshot", key: readingKey(request), value: { ok: 1 } }),
  });
  expect(registry.get(atom)).toEqual({ state: "ready", observation: { ok: 1 } });

  await vi.advanceTimersByTimeAsync(30_000);
  expect(registry.get(atom)).toEqual({ state: "ready", observation: { ok: 1 } });
  expect(console.error).not.toHaveBeenCalled();
  unsubscribe();
  readings.close();
});
