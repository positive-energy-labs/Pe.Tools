import { harnessEventSchema } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { harnessClient, streamThread, type OpenEvents } from "./harness-client";

class FakeSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  /** One `thread` Reading frame, carrying its host log id as the SSE id. */
  emit(seq: number, id: number) {
    const event = harnessEventSchema.parse({
      seq,
      at: "2026-10-01T12:00:00.000Z",
      kind: "turn_end",
      turnId: "t1",
      stopReason: "end_turn",
    });
    const frame = { kind: "event", key: "k", value: event, id };
    this.onmessage?.({
      data: JSON.stringify(frame),
      lastEventId: String(id),
    } as MessageEvent<string>);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("harnessClient", () => {
  it("sends the json content type on every non-GET, bodiless or not", async () => {
    const sent: { method: string; type: string | null; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push({
        method: init.method ?? "GET",
        type: new Headers(init.headers).get("content-type"),
        body: init.body,
      });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (_url.endsWith("/cancel")) return Response.json({ cancelled: false });
      if (_url.endsWith("/prompt")) return Response.json({ turnId: "turn", state: "running" });
      return Response.json(emptyChatState());
    });
    const client = harnessClient("http://host");
    await client.cancel("t");
    await client.remove("t");
    await client.prompt("t", { text: "hi" });
    await client.body("t");
    expect(sent).toEqual([
      { method: "POST", type: "application/json", body: undefined },
      { method: "DELETE", type: "application/json", body: undefined },
      {
        method: "POST",
        type: "application/json",
        body: expect.stringMatching(/^\{"id":"[0-9a-f-]{36}","text":"hi"\}$/),
      },
      { method: "GET", type: null, body: undefined },
    ]);
  });
});

describe("streamThread", () => {
  const cursorOf = (url: string) => {
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/pe/resources");
    expect(JSON.parse(parsed.searchParams.get("keys")!)).toEqual([
      { kind: "thread", thread: "th 1" },
    ]);
    return Number(parsed.searchParams.get("after"));
  };
  it("follows the thread Reading from the body's cursor and resumes from the last log id", () => {
    vi.useFakeTimers();
    const sources: FakeSource[] = [];
    const open = ((url: string) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    }) as unknown as OpenEvents;
    const seen: number[] = [];
    let rereads = 0;
    const stop = streamThread({
      origin: "http://host",
      threadId: "th 1",
      cursor: 40,
      lastSeq: 4,
      open,
      onEvent: (event) => seen.push(event.seq),
      onReread: () => rereads++,
    });

    expect(cursorOf(sources[0]!.url)).toBe(40);
    sources[0]!.emit(4, 40); // already in the body: skipped
    sources[0]!.emit(5, 41);
    sources[0]!.emit(6, 42);
    sources[0]!.onerror?.();
    expect(sources[0]!.closed).toBe(true);
    vi.advanceTimersByTime(1_000);

    expect(cursorOf(sources[1]!.url)).toBe(42);
    sources[1]!.emit(6, 42); // a replay across the reconnect: skipped
    sources[1]!.emit(7, 43);
    expect(seen).toEqual([5, 6, 7]);

    // A hole in seq: re-read the body; this stream is done.
    sources[1]!.emit(9, 45);
    expect([rereads, sources[1]!.closed]).toEqual([1, true]);
    vi.advanceTimersByTime(5_000);
    expect(sources).toHaveLength(2);
    stop();
  });
});
