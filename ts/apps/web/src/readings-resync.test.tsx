// @vitest-environment jsdom
/**
 * The one Readings owner's liveness rule: a faulted, silent or woken stream marks its Readings
 * stale, reconnects with backoff, has every follower (a thread's log tail) re-read, and only a
 * fresh frame clears the mark. Real frames over stand-in transports; no module is mocked.
 */
import { act, cleanup, render } from "@testing-library/react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { harnessThreadBodySchema, readingFrameSchema, readingKey } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { RegistryContext } from "@effect/atom-react";

import { PeReadings, readingAtom, previousOf, useReadingSlice } from "./readings";
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

function owner(
  batch: (deliver: () => void) => () => void = (deliver) => {
    deliver();
    return () => {};
  },
) {
  const sources: Fake[] = [];
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
  );
  return { readings, sources };
}

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

test("a tab shown after sleeping resyncs once, and the thread re-reads its body and tail", async () => {
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
  await vi.waitFor(() => expect(sources).toHaveLength(2));
  expect(sources[0]!.closed).toBe(true);
  act(() => sources[1]!.onopen!());

  // The view is marked stale until the re-read body lands, then the tail reopens from its cursor.
  expect(seen.some((s) => s.stale && s.error?.includes("not current"))).toBe(true);
  await vi.waitFor(() => expect(bodyReads).toHaveLength(2));
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ stale: false, error: null }));
  expect(tails[0]!.closed).toBe(true);
  expect(tails.at(-1)!.closed).toBe(false);
  expect(tails.at(-1)!.url).toContain("after=2");
  expect(sources).toHaveLength(2);

  release();
  readings.close();
});
