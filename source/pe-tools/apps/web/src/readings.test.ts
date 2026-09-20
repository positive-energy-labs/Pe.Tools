import { describe, expect, it } from "vite-plus/test";
import { readingKey, type Reading } from "@pe/agent-contracts";
import { advance, PeReadings } from "./readings.ts";

type Fake = {
  url: string;
  closed: boolean;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  close: () => void;
};

function owner() {
  const streams: Fake[] = [];
  const readings = new PeReadings(
    () => "http://host/pe/resources",
    (url) => {
      const fake: Fake = {
        url,
        closed: false,
        onopen: null,
        onmessage: null,
        onerror: null,
        close: () => {
          fake.closed = true;
        },
      };
      streams.push(fake);
      return fake as unknown as EventSource;
    },
  );
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  return { readings, streams, flush };
}

const snapshot = (key: string, value: unknown) =>
  ({ data: JSON.stringify({ kind: "snapshot", key, value }) }) as MessageEvent;

describe("PeReadings topology swap", () => {
  it("a key joining never marks an already-observed key stale, and retires the old stream on open", async () => {
    const { readings, streams, flush } = owner();
    const seen: string[] = [];
    readings.subscribe({ kind: "host-status" }, (frame) => seen.push(frame.kind));
    await flush();
    expect(streams).toHaveLength(1);
    streams[0]!.onopen?.(new Event("open"));
    streams[0]!.onmessage?.(snapshot(readingKey({ kind: "host-status" }), { ok: true }));
    expect(seen).toEqual(["stale", "snapshot"]);

    readings.subscribe({ kind: "inventory" }, () => {});
    await flush();
    expect(streams).toHaveLength(2);
    // The first stream is still open until the replacement proves itself.
    expect(streams[0]!.closed).toBe(false);
    expect(seen).toEqual(["stale", "snapshot"]);
    streams[1]!.onopen?.(new Event("open"));
    expect(streams[0]!.closed).toBe(true);
    expect(seen).toEqual(["stale", "snapshot"]);
  });

  it("dirty still fences every key", async () => {
    const { readings, streams, flush } = owner();
    const seen: string[] = [];
    readings.subscribe({ kind: "host-status" }, (frame) => seen.push(frame.kind));
    await flush();
    streams[0]!.onopen?.(new Event("open"));
    readings.dirty({ kind: "host-status" });
    await flush();
    expect(streams[0]!.closed).toBe(true);
    expect(seen).toEqual(["stale", "stale"]);
  });

  it("releases each subject when its last listener leaves, so focus reads can churn past the key cap", async () => {
    const { readings, flush } = owner();
    for (let i = 0; i < 40; i++) {
      const release = readings.subscribe(
        { kind: "member", member: { pod: "proof", path: `${i}.json` } },
        () => {},
      );
      await flush();
      release();
      await flush();
    }
  });
});

describe("advance snapshot identity", () => {
  const value = { sessions: [{ id: "one", connected: true }], revision: 3 };
  const ready: Reading<typeof value> = { state: "ready", observation: value };
  const frame = (next: unknown) => ({ kind: "snapshot", key: "inventory", value: next }) as never;

  it("keeps a ready wrapper for an unchanged JSON-wire snapshot", () => {
    expect(advance(ready, frame(structuredClone(value)))).toBe(ready);
  });

  it("returns a new ready wrapper when the snapshot changes", () => {
    const next = advance(ready, frame({ ...value, revision: 4 }));
    expect(next).not.toBe(ready);
    expect(next).toEqual({ state: "ready", observation: { ...value, revision: 4 } });
  });

  it("restores ready after stale or failed state even when evidence is equal", () => {
    const stale = advance(ready, { kind: "gap", key: "inventory" } as never);
    const failed = advance(ready, { kind: "failure", key: "inventory", error: "offline" } as never);
    const afterStale = advance(stale, frame(structuredClone(value)));
    const afterFailure = advance(failed, frame(structuredClone(value)));
    expect(afterStale).toEqual({ state: "ready", observation: value });
    expect(afterFailure).toEqual({ state: "ready", observation: value });
    expect(afterStale).not.toBe(stale);
    expect(afterFailure).not.toBe(failed);
  });
});
