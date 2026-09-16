import { describe, expect, it } from "vite-plus/test";
import { readingKey } from "@pe/agent-contracts";
import { PeReadings } from "./readings.ts";

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
});
