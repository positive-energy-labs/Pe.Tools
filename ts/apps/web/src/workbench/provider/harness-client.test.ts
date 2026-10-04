import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { harnessEventSchema } from "@pe/agent-contracts";

import { harnessClient, notFound, streamThread, type OpenEvents } from "./harness-client";

class FakeSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  emit(seq: number) {
    const event = harnessEventSchema.parse({
      seq,
      at: "2026-10-01T12:00:00.000Z",
      kind: "turn_end",
      turnId: "t1",
      stopReason: "end_turn",
    });
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("harnessClient", () => {
  it("marks a 404 so a stale ?thread= renders as no such thread", async () => {
    vi.stubGlobal("fetch", async () => new Response("no thread", { status: 404 }));
    const failed = await harnessClient("http://host")
      .body("gone")
      .catch((error: unknown) => error);
    expect(notFound(failed)).toBe(true);
    expect(notFound(new Error("other"))).toBe(false);
  });

  it("sends the json content type on every non-GET, bodiless or not", async () => {
    const sent: { method: string; type: string | null; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push({
        method: init.method ?? "GET",
        type: new Headers(init.headers).get("content-type"),
        body: init.body,
      });
      return new Response(null, { status: 204 });
    });
    const client = harnessClient("http://host");
    await client.cancel("t");
    await client.remove("t");
    await client.prompt("t", "hi");
    await client.body("t");
    expect(sent).toEqual([
      { method: "POST", type: "application/json", body: undefined },
      { method: "DELETE", type: "application/json", body: undefined },
      { method: "POST", type: "application/json", body: '{"text":"hi"}' },
      { method: "GET", type: null, body: undefined },
    ]);
  });
});

describe("streamThread", () => {
  it("resumes from the last delivered seq after the stream drops", () => {
    vi.useFakeTimers();
    const sources: FakeSource[] = [];
    const open = ((url: string) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    }) as unknown as OpenEvents;
    const seen: number[] = [];
    const stop = streamThread({
      origin: "http://host",
      threadId: "th 1",
      after: 4,
      open,
      onEvent: (event) => seen.push(event.seq),
    });

    expect(sources[0]!.url).toBe("http://host/pe/threads/th%201/stream?after=4");
    sources[0]!.emit(4); // already in the body: dropped
    sources[0]!.emit(5);
    sources[0]!.emit(6);
    sources[0]!.onerror?.();
    expect(sources[0]!.closed).toBe(true);
    vi.advanceTimersByTime(1_000);

    expect(sources[1]!.url).toBe("http://host/pe/threads/th%201/stream?after=6");
    sources[1]!.emit(6); // a replay across the reconnect: dropped
    sources[1]!.emit(7);
    expect(seen).toEqual([5, 6, 7]);

    stop();
    expect(sources[1]!.closed).toBe(true);
    sources[1]!.onerror?.();
    vi.advanceTimersByTime(5_000);
    expect(sources).toHaveLength(2);
  });
});
