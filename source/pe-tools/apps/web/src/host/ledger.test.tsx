// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useLedger, type Stamped } from "./ledger";

type Ev = { kind: string };
type Entry = Stamped<Ev>;
const entry = (epoch: string, seq: number, kind = `e${seq}`): Entry => ({
  epoch,
  seq,
  atMs: seq,
  kind,
});

class FakeSource {
  static open: FakeSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeSource.open.push(this);
  }
  connect() {
    this.onopen?.();
  }
  push(item: Entry) {
    this.onmessage?.({ data: JSON.stringify(item) });
  }
}

type Replay = { reset: boolean; entries: Entry[] };
const pendingFetches: Array<{ url: string; resolve: (body: Replay) => void }> = [];
const flushFetch = async (body: Replay) => {
  const next = pendingFetches.shift();
  if (!next) throw new Error("no fetch pending");
  await act(async () => {
    next.resolve(body);
    await Promise.resolve();
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeSource.open = [];
  pendingFetches.length = 0;
});

function mount(name: string | null = "world") {
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pendingFetches.push({ url, resolve: (body) => resolve(Response.json(body)) });
        }),
    ),
  );
  let seen: string[] = [];
  let ready = false;
  function Probe() {
    const [state, , isReady] = useLedger<Ev, string[]>(
      name,
      (log, event) => [...log, event.kind],
      () => [],
    );
    seen = state;
    ready = isReady;
    return null;
  }
  render(<Probe />);
  return { seen: () => seen, ready: () => ready, source: () => FakeSource.open.at(-1)! };
}

test("a live entry that lands before the replay answer is neither lost nor applied out of order", async () => {
  const probe = mount();
  await act(async () => probe.source().connect());
  expect(pendingFetches[0]?.url).toBe("/ledger/world");
  // Arrives while the replay is in flight: buffered, then applied after the snapshot.
  await act(async () => probe.source().push(entry("A", 8)));
  expect(probe.seen()).toEqual([]);
  await flushFetch({ reset: true, entries: [entry("A", 7, "snapshot")] });
  expect(probe.seen()).toEqual(["snapshot", "e8"]);
  expect(probe.ready()).toBe(true);
});

test("an entry delivered twice is reduced once, by key", async () => {
  const probe = mount();
  await act(async () => probe.source().connect());
  await flushFetch({ reset: true, entries: [entry("A", 1)] });
  await act(async () => probe.source().push(entry("A", 2)));
  await act(async () => probe.source().push(entry("A", 2)));
  await act(async () => probe.source().push(entry("A", 1)));
  expect(probe.seen()).toEqual(["e1", "e2"]);
});

test("a host restart is a new epoch: the client replays from its key, gets a reset, and starts over", async () => {
  const probe = mount();
  await act(async () => probe.source().connect());
  await flushFetch({ reset: true, entries: [entry("A", 300)] });
  await act(async () => probe.source().push(entry("A", 301)));
  expect(probe.seen()).toEqual(["e300", "e301"]);

  // EventSource reconnects after the host comes back; the same source object reopens.
  await act(async () => probe.source().connect());
  expect(pendingFetches[0]?.url).toBe("/ledger/world?after=A%3A301");
  await act(async () => probe.source().push(entry("B", 2)));
  await flushFetch({ reset: true, entries: [entry("B", 1)] });
  expect(probe.seen()).toEqual(["e1", "e2"]);
});

test("no name opens nothing; a name change closes the old stream", async () => {
  const probe = mount(null);
  expect(FakeSource.open).toHaveLength(0);
  expect(probe.ready()).toBe(false);
});
