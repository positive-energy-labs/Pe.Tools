// @vitest-environment jsdom
/**
 * The one Readings owner's liveness rule: a faulted, silent or woken stream marks its Readings
 * stale, reconnects with backoff, has every follower (a thread's log tail) re-read, and only a
 * fresh frame clears the mark. Real frames over stand-in transports; no module is mocked.
 */
import { act, cleanup, render } from "@testing-library/react";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  actionReceiptSchema,
  harnessThreadBodySchema,
  readingFrameSchema,
  readingKey,
} from "@pe/agent-contracts";
import { submitAction } from "../../../packages/mcps/src/shared/takeoff-action-client";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { RegistryContext } from "@effect/atom-react";

import { PeReadings, peReadings, useHostEvents, bindActionReadings } from "./host/resource-stream";
import { readingAtom, previousOf, useReading, useReadingSlice } from "#/host/resource-state";
import { useProviders } from "./workbench/provider/providers";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture";
import { useThreadStream } from "./workbench/provider/thread-stream";

type Fake = {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  closed: boolean;
  close: () => void;
};

const head = { kind: "thread-head", thread: "t1" } as const;
const snapshot = (value: unknown) => ({
  data: JSON.stringify(
    readingFrameSchema.parse({ kind: "snapshot", key: readingKey(head), value }),
  ),
});

test("transport delivers when a visible tab's animation frame never runs", async () => {
  vi.useFakeTimers();
  const raf = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", raf);
  const sources: Fake[] = [];
  const readings = new PeReadings(() => "http://localhost/readings", url => {
    const source: Fake = { url, onopen: null, onmessage: null, onerror: null,
      closed: false, close() { this.closed = true; } };
    sources.push(source);
    return source;
  }, undefined, async () => {});
  const received = vi.fn();
  try {
    readings.subscribe(head, received);
    await vi.advanceTimersByTimeAsync(0);
    sources[0]!.onopen!();
    sources[0]!.onmessage!(snapshot({ retained: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ value: { retained: true } }));
    expect(raf).not.toHaveBeenCalled();
  } finally {
    readings.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

function owner(
  batch: (deliver: () => void) => () => void = (deliver) => {
    deliver();
    return () => {};
  },
) {
  const sources: Fake[] = [];
  const subscriptions = new Set<string>();
  const update = vi.fn(
    async (
      _connection: string,
      add: import("@pe/agent-contracts").ReadingRequest[],
      remove: string[],
    ) => {
      for (const key of remove) subscriptions.delete(key);
      for (const request of add) subscriptions.add(readingKey(request));
    },
  );
  const readings = new PeReadings(
    () => "http://127.0.0.1:5180/readings",
    (url) => {
      const source: Fake = {
        url,
        onopen: null,
        onmessage: null,
        onerror: null,
        closed: false,
        close: () => void (source.closed = true),
      };
      sources.push(source);
      return source as unknown as EventSource;
    },
    batch,
    update,
  );
  return { readings, sources, subscriptions, update };
}

test.each(["ECONNREFUSED", "Reading subscriptions: 403"])("a failed POST (%s) fences even a delivered snapshot", async (failure) => {
  vi.useFakeTimers();
  const { readings, sources, update } = owner();
  const frames: unknown[] = [];
  let reject!: (error: Error) => void;
  update.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  try {
    readings.subscribe(head, (frame) => frames.push(frame));
    readings.subscribe({ kind: "machine" }, () => {});
    await vi.advanceTimersByTimeAsync(0);
    sources[0]!.onopen!();
    expect(update.mock.calls[0]![1]).toEqual([head, { kind: "machine" }]);
    sources[0]!.onmessage!(snapshot({ revision: 1 }));
    expect(frames.at(-1)).toMatchObject({ kind: "snapshot", value: { revision: 1 } });
    reject(Error(failure));
    await vi.advanceTimersByTimeAsync(0);
    expect(sources[0]!.closed).toBe(true);
    expect(frames.at(-1)).toEqual({ kind: "stale", key: readingKey(head) });
    expect(update).toHaveBeenCalledTimes(1);
    readings.close();
    await vi.advanceTimersByTimeAsync(31_001);
    expect(sources).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
  } finally { readings.close(); vi.useRealTimers(); }
});

test("an old bootstrap completion cannot mark a replacement's subscriptions sent", async () => {
  const { readings, sources, update } = owner();
  let finish!: () => void;
  update.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  try {
    readings.subscribe(head, () => {});
    await Promise.resolve();
    expect(new URL(sources[0]!.url).searchParams.has("keys")).toBe(false);
    sources[0]!.onopen!();
    expect(update).toHaveBeenCalledTimes(1);
    readings.dirty(head);
    await Promise.resolve();
    sources[1]!.onopen!();
    finish();
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls.map(([id]) => id)).toEqual(sources.map(source => new URL(source.url).searchParams.get("connection")));
    expect(update.mock.calls.map(([, add]) => add)).toEqual([[head], [head]]);
    readings.close();
    expect(sources.every(source => source.closed)).toBe(true);
    sources[1]!.onopen!();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);
  } finally { readings.close(); }
  const unopened = owner();
  unopened.readings.subscribe(head, () => {});
  await Promise.resolve();
  unopened.readings.close();
  unopened.sources[0]!.onopen!();
  await Promise.resolve();
  expect(unopened.update).not.toHaveBeenCalled();
});

test("an acknowledged command completes on the existing receipt stream without an HTTP waiter", async () => {
  const { readings, sources } = owner();
  const release = bindActionReadings(readings);
  const admission = {
    id: "observed-command",
    key: "host.shell.open",
    target: { kind: "host" as const },
    input: { path: "C:/Review" },
  };
  const row = actionReceiptSchema.parse({
    ...admission,
    state: "running",
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    prepared: { state: "unprepared" },
    steps: [],
    recovery: [],
    startedAt: "2026-10-27T10:00:00Z",
  });
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, request: RequestInit) => {
    calls.push(request.method!);
    return Response.json(row);
  });
  try {
    const completion = submitAction(admission);
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    sources[0]!.onopen!();
    const subject = { kind: "receipts", id: admission.id } as const;
    sources[0]!.onmessage!({
      data: JSON.stringify({ kind: "snapshot", key: readingKey(subject), value: [row] }),
    });
    sources[0]!.onmessage!({
      data: JSON.stringify({
        kind: "snapshot",
        key: readingKey(subject),
        value: [{ ...row, state: "succeeded", result: {} }],
      }),
    });
    await expect(completion).resolves.toMatchObject({ id: admission.id, state: "succeeded" });
    expect(calls).toEqual(["POST"]);
  } finally {
    release();
    readings.close();
  }
});

test("late readings join and leave without reopening the page stream", async () => {
  const { readings, sources } = owner();
  const release = readings.subscribe({ kind: "world" }, () => {});
  await Promise.resolve();
  sources[0]!.onopen!();
  const releases = Array.from({ length: 100 }, (_, n) =>
    readings.subscribe({ kind: "receipts", id: String(n) }, () => {}),
  );
  await Promise.resolve();
  expect(sources).toHaveLength(1);
  for (const remove of releases) remove();
  await Promise.resolve();
  expect(sources).toHaveLength(1);
  release();
  readings.close();
});

test("an overlapping handover delivers a route command once to each mounted follower", async () => {
  const listeners = new Set<Parameters<PeReadings["subscribe"]>[1]>();
  const subscription = vi.spyOn(peReadings, "subscribe").mockImplementation((_request, accept) => {
    listeners.add(accept);
    return () => void listeners.delete(accept);
  });
  const received: unknown[] = [];
  function Probe() {
    useHostEvents(true, (event) => received.push(event));
    return null;
  }
  const view = render(<Probe />);
  const frame = {
    kind: "event",
    key: readingKey({ kind: "world" }),
    value: { type: "route-view-open", commandId: "same-command" },
  } as const;
  act(() => {
    for (const accept of listeners) {
      accept(frame);
      accept(frame);
    }
  });
  expect(received).toEqual([frame.value]);
  view.unmount();
  subscription.mockRestore();
});

test("invalidation fences old evidence while the active connection still delivers commands", async () => {
  const { readings, sources } = owner();
  const world = { kind: "world" } as const;
  const frames: unknown[] = [];
  const states: unknown[] = [];
  const releaseWorld = readings.subscribe(world, (frame) => {
    if (frame.kind === "event") frames.push(frame.value);
  });
  const releaseHead = readings.subscribe(head, (frame) => states.push(frame));
  await Promise.resolve();
  const active = sources[0]!;
  active.onopen!();
  active.onmessage!(snapshot({ revision: 1 }));
  readings.dirty(head);
  expect(active.closed).toBe(false);
  active.onmessage!(snapshot({ revision: 999 }));
  active.onmessage!({
    data: JSON.stringify({
      kind: "event",
      key: readingKey(world),
      value: { type: "route-view-open", commandId: "during-write" },
    }),
  });
  expect(states.at(-1)).toEqual({ kind: "stale", key: readingKey(head) });
  expect(frames).toEqual([{ type: "route-view-open", commandId: "during-write" }]);
  await Promise.resolve();
  sources[1]!.onopen!();
  sources[1]!.onmessage!(snapshot({ revision: 2 }));
  expect(states.at(-1)).toEqual({
    kind: "snapshot",
    key: readingKey(head),
    value: { revision: 2 },
  });
  releaseWorld();
  releaseHead();
  readings.close();
});

/** Thread body reads (`thread.get`) and thread tails, as the host answers them. */
const bodyReads: string[] = [];
const tails: { url: string; closed: boolean }[] = [];
beforeEach(() => {
  bodyReads.length = 0;
  tails.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path === "/pe/threads/t1") {
      bodyReads.push(path);
      const body = harnessThreadBodySchema.parse({
        ...emptyChatState(),
        id: "t1",
        cursor: bodyReads.length,
      });
      return Response.json(body);
    }
    return Response.json({});
  });
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage = null;
      onerror = null;
      readonly tail: { url: string; closed: boolean };
      constructor(url: string) {
        this.tail = { url, closed: false };
        tails.push(this.tail);
      }
      close() {
        this.tail.closed = true;
      }
    },
  );
});

test("one frame publishes each resource's final snapshot only to its own changed subscribers", async () => {
  let deliver: (() => void) | undefined;
  const { readings, sources } = owner((next) => {
    deliver = next;
    return () => {
      deliver = undefined;
    };
  });
  const first = vi.fn();
  const second = vi.fn();
  const other = { kind: "thread-head", thread: "t2" } as const;
  const release = readings.subscribe(head, first);
  const releaseOther = readings.subscribe(other, second);
  await Promise.resolve();
  const source = sources[0]!;
  const send = (request: typeof head | typeof other, value: unknown) =>
    source.onmessage!({
      data: JSON.stringify({ kind: "snapshot", key: readingKey(request), value }),
    });
  first.mockClear();
  second.mockClear();
  send(head, { revision: 1 });
  send(head, { revision: 2 });
  expect(first).not.toHaveBeenCalled();
  deliver!();
  expect(first).toHaveBeenCalledTimes(1);
  expect(first.mock.calls[0]![0]).toMatchObject({ value: { revision: 2 } });
  expect(second).not.toHaveBeenCalled();
  first.mockClear();
  send(head, { revision: 2 });
  send(other, { revision: 1 });
  deliver!();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  source.onmessage!({ data: JSON.stringify({ kind: "gap", key: readingKey(head), dropped: 1 }) });
  deliver!();
  first.mockClear();
  send(head, { revision: 2 });
  deliver!();
  expect(first).toHaveBeenCalledTimes(1); // Equal evidence still reacquires freshness after a gap.
  first.mockClear();
  // A pending fresh frame cannot cross an invalidation fence.
  send(head, { revision: 3 });
  readings.dirty(head);
  expect(deliver).toBeUndefined();
  expect(first).toHaveBeenCalledWith({ kind: "stale", key: readingKey(head) });
  release();
  releaseOther();
  await Promise.resolve();
  expect(sources.every((source) => source.closed)).toBe(true);
  readings.close();
});

test("a reading selector ignores polling fields and follows a changed selector immediately", async () => {
  const { readings, sources } = owner();
  const registry = AtomRegistry.make();
  let renders = 0;
  function Probe({ field }: { field: "value" | "poll" }) {
    const value = useReadingSlice<{ value: number; poll: number }, number>(
      head,
      (reading) => previousOf(reading)?.[field] ?? 0,
      readings,
    );
    renders++;
    return <output>{value}</output>;
  }
  const view = render(
    <RegistryContext.Provider value={registry}>
      <Probe field="value" />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(sources).toHaveLength(1));
  act(() => sources[0]!.onmessage!(snapshot({ value: 7, poll: 1 })));
  expect(view.container.textContent).toBe("7");
  const before = renders;
  act(() => sources[0]!.onmessage!(snapshot({ value: 7, poll: 2 })));
  expect(renders).toBe(before);
  view.rerender(
    <RegistryContext.Provider value={registry}>
      <Probe field="poll" />
    </RegistryContext.Provider>,
  );
  expect(view.container.textContent).toBe("2");
  view.unmount();
  readings.close();
  registry.dispose();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the composer provider helper ignores Machine polling metadata but follows its own error", async () => {
  const { readings, sources } = owner();
  const subscription = vi
    .spyOn(peReadings, "subscribe")
    .mockImplementation((request, accept) => readings.subscribe(request, accept));
  const registry = AtomRegistry.make();
  let renders = 0;
  function Probe() {
    const providers = useProviders("http://127.0.0.1:5180");
    renders++;
    return <output>{providers.error ?? "ready"}</output>;
  }
  const view = render(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(sources).toHaveLength(1));
  const machine = { ...machineFixture(), providers: [] };
  const send = (value: typeof machine) =>
    act(() =>
      sources[0]!.onmessage!({
        data: JSON.stringify({ kind: "snapshot", key: readingKey({ kind: "machine" }), value }),
      }),
    );
  send(machine);
  const before = renders;
  send({ ...machine, observedAtUtc: "2026-10-23T06:00:00Z" });
  expect(renders).toBe(before);
  send({
    ...machine,
    legs: {
      ...machine.legs,
      providers: { observedAtUtc: null, attemptedAtUtc: null, error: "provider unavailable" },
    },
  });
  expect(view.container.textContent).toBe("provider unavailable");
  view.unmount();
  registry.dispose();
  readings.close();
  subscription.mockRestore();
});

test("a faulted stream goes stale, reconnects with backoff, and only fresh data clears it", async () => {
  vi.useFakeTimers();
  const { readings, sources } = owner();
  let resyncs = 0;
  readings.onResync(() => resyncs++);
  const registry = AtomRegistry.make();
  const atom = readingAtom(head, readings);
  const release = registry.subscribe(atom, () => {}, { immediate: true });
  await vi.advanceTimersByTimeAsync(0);
  sources[0]!.onopen!();
  sources[0]!.onmessage!(snapshot({ revision: 1 }));
  expect(registry.get(atom).state).toBe("ready");

  // The stream drops: the Reading is visibly stale, keeping its last evidence.
  sources[0]!.onerror!();
  expect(registry.get(atom)).toMatchObject({ state: "stale", reason: "disconnected" });
  await vi.advanceTimersByTimeAsync(999);
  expect(sources).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(sources).toHaveLength(2);
  // A reconnect that also fails waits twice as long.
  sources[1]!.onerror!();
  await vi.advanceTimersByTimeAsync(1_999);
  expect(sources).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(sources).toHaveLength(3);

  // The reconnect opens: followers re-read; the socket alone proves nothing fresh.
  sources[2]!.onopen!();
  expect(resyncs).toBe(1);
  expect(registry.get(atom).state).toBe("stale");
  sources[2]!.onmessage!(snapshot({ revision: 4 }));
  expect(registry.get(atom)).toEqual({ state: "ready", observation: { revision: 4 } });

  // A stream that opens and then says nothing for a still-unanswered key is dead, not quiet.
  readings.dirty(head);
  await vi.advanceTimersByTimeAsync(0);
  sources[3]!.onopen!();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(sources[3]!.closed).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sources).toHaveLength(5);

  release();
  readings.close();
});

test("a tab shown after sleeping retains its thread body and tail", async () => {
  const { readings, sources } = owner();
  const registry = AtomRegistry.make();
  const release = registry.subscribe(readingAtom(head, readings), () => {}, { immediate: true });
  const seen: { stale: boolean; error: string | null }[] = [];
  function Thread() {
    const stream = useThreadStream({ origin: "http://127.0.0.1:5180", threadId: "t1", readings });
    seen.push({ stale: stream.stale, error: stream.error?.message ?? null });
    return null;
  }
  render(<Thread />);
  await vi.waitFor(() => expect(tails).toHaveLength(1));
  expect(bodyReads).toHaveLength(1);
  sources[0]!.onopen!();
  sources[0]!.onmessage!(snapshot({ revision: 1 }));

  // The tab hides, sleeps, and is shown; two wake signals in one tick are one reconnect.
  const now = Date.now();
  const at = (ms: number) => vi.setSystemTime(now + ms);
  vi.useFakeTimers({ toFake: ["Date"] });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  at(60_000);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  vi.useRealTimers();
  await act(async () => {});
  expect(sources).toHaveLength(1);
  expect(sources[0]!.closed).toBe(false);
  expect(bodyReads).toHaveLength(1);
  expect(tails).toHaveLength(1);
  expect(tails[0]!.closed).toBe(false);
  expect(seen.at(-1)).toEqual({ stale: false, error: null });

  release();
  readings.close();
});

test("reopened thread with 100 action records shares each reading and releases all on unmount", async () => {
  const { readings, sources, subscriptions } = owner();
  const registry = AtomRegistry.make();
  function Record({ id }: { id: string }) {
    const value = useReading({ kind: "receipts", id }, readings);
    return <span>{value.state}</span>;
  }
  const tree = (
    <RegistryContext.Provider value={registry}>
      {Array.from({ length: 200 }, (_, i) => (
        <Record key={i} id={String(i % 100)} />
      ))}
    </RegistryContext.Provider>
  );
  for (let pass = 0; pass < 2; pass++) {
    const view = render(tree);
    await act(async () => {
      await Promise.resolve();
    });
    if (pass === 0) sources[0]!.onopen!();
    await vi.waitFor(() => expect(subscriptions.size).toBe(100));
    expect(sources).toHaveLength(1);
    view.unmount();
    await vi.waitFor(() => expect(subscriptions.size).toBe(0));
  }
  registry.dispose();
  readings.close();
});

test("a remounted reading immediately retains its previous observation while reacquiring", async () => {
  const { readings, sources } = owner();
  let registry = AtomRegistry.make();
  let release = registry.subscribe(readingAtom(head, readings), () => {}, { immediate: true });
  await Promise.resolve();
  sources[0]!.onopen!();
  sources[0]!.onmessage!(snapshot({ revision: 1 }));
  release();
  registry.dispose();
  registry = AtomRegistry.make();
  release = registry.subscribe(readingAtom(head, readings), () => {}, { immediate: true });
  expect(previousOf(registry.get(readingAtom(head, readings)))).toEqual({ revision: 1 });
  release();
  registry.dispose();
  readings.close();
});

test("online replaces a socket that never reported its offline failure", async () => {
  const { readings, sources } = owner();
  const received: unknown[] = [];
  const release = readings.subscribe(head, (frame) => received.push(frame));
  await Promise.resolve();
  sources[0]!.onopen!();
  sources[0]!.onmessage!(snapshot({ revision: 1 }));
  window.dispatchEvent(new Event("offline"));
  window.dispatchEvent(new Event("online"));
  await Promise.resolve();
  expect(sources).toHaveLength(2);
  expect(received.at(-1)).toMatchObject({ kind: "stale" });
  sources[1]!.onopen!();
  sources[1]!.onmessage!(snapshot({ revision: 2 }));
  expect(received.at(-1)).toMatchObject({ kind: "snapshot", value: { revision: 2 } });
  release();
  readings.close();
});

test("retention evicts least-recent revisits, exempts mounted subjects, and refetches evictions", async () => {
  const { readings, sources, update } = owner();
  const request = (thread: string) => ({ kind: "thread-head", thread }) as const;
  const emit = (thread: string, revision = 1) =>
    sources[0]!.onmessage!({
      data: JSON.stringify({
        kind: "snapshot",
        key: readingKey(request(thread)),
        value: { revision },
      }),
    });
  const releaseMounted = readings.subscribe(request("mounted"), () => {});
  try {
    await Promise.resolve();
    sources[0]!.onopen!();
    emit("mounted");
    for (let i = 0; i < 64; i++) {
      const release = readings.subscribe(request(String(i)), () => {});
      emit(String(i));
      release();
    }
    const revisit = vi.fn();
    readings.subscribe(request("0"), revisit)();
    expect(revisit).toHaveBeenCalledWith(expect.objectContaining({ kind: "snapshot" }));
    const releaseExtra = readings.subscribe(request("extra"), () => {});
    emit("extra");
    releaseExtra();
    const recent = vi.fn();
    readings.subscribe(request("0"), recent)();
    expect(recent).toHaveBeenCalledWith(expect.objectContaining({ kind: "snapshot" }));
    const mountedAgain = vi.fn();
    readings.subscribe(request("mounted"), mountedAgain)();
    expect(mountedAgain).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "snapshot", stale: false }),
    );
    const evicted = vi.fn();
    const releaseEvicted = readings.subscribe(request("1"), evicted);
    expect(evicted.mock.calls).toEqual([[{ kind: "stale", key: readingKey(request("1")) }]]);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      update.mock.calls.some(([, add]) =>
        add.some((r) => readingKey(r) === readingKey(request("1"))),
      ),
    ).toBe(true);
    emit("1", 2);
    expect(evicted).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "snapshot", value: { revision: 2 } }),
    );
    releaseEvicted();
  } finally {
    releaseMounted();
    readings.close();
  }
});
