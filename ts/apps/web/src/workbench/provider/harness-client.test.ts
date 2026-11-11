import { harnessEventSchema } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ReadingRequest } from "@pe/agent-contracts";
import { harnessClient, streamThread } from "./harness-client";

type Listener = Parameters<NonNullable<Parameters<typeof streamThread>[0]["readings"]>["subscribe"]>[1];
/** The tab's one stream, stood in: each subscription is one key, with its own cursor. */
class FakeReadings {
  readonly keys: { request: ReadingRequest; listener: Listener; released: boolean }[] = [];
  subscribe = (request: ReadingRequest, listener: Listener) => {
    const key = { request, listener, released: false };
    this.keys.push(key);
    // A new key is stale until the host answers it, as `PeReadings.subscribe` says.
    listener({ kind: "stale", key: "k" });
    return () => void (key.released = true);
  };
  /** One `thread` Reading frame, carrying its host log id. */
  emit(index: number, seq: number, id: number) {
    const value = harnessEventSchema.parse({
      seq,
      at: "2026-10-01T12:00:00.000Z",
      kind: "turn_end",
      turnId: "t1",
      stopReason: "end_turn",
    });
    this.keys[index]!.listener({ kind: "event", key: "k", value, id });
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
  it("a refused log tail rereads retained completion instead of leaving the turn running", () => {
    const readings = new FakeReadings();
    const reread = vi.fn();
    const fault = vi.fn();
    const event = vi.fn();
    const stop = streamThread({ threadId: "th 1", cursor: 40, lastSeq: 4,
      readings, onEvent: event, onReread: reread, onFault: fault });
    readings.keys[0]!.listener({ kind: "failure", key: "k", error: "Mark-frame capture backlog exceeded its bound" });
    expect(reread).toHaveBeenCalledOnce();
    expect(fault).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("backlog") }));
    expect(readings.keys[0]!.released).toBe(true);
    expect(event).not.toHaveBeenCalled();
    stop();
  });
  it("follows the thread Reading from the body's cursor and resumes from the last log id", () => {
    const readings = new FakeReadings();
    const seen: number[] = [];
    let rereads = 0;
    const stop = streamThread({
      threadId: "th 1",
      cursor: 40,
      lastSeq: 4,
      readings,
      onEvent: (event) => seen.push(event.seq),
      onReread: () => rereads++,
    });

    // One key on the tab's stream, carrying its own cursor: no stream of its own.
    expect(readings.keys.map((key) => key.request)).toEqual([
      { kind: "thread", thread: "th 1", after: 40 },
    ]);
    readings.emit(0, 4, 40); // already in the body: skipped
    readings.emit(0, 5, 41);
    readings.emit(0, 6, 42);
    // The stream is fenced or reconnects: the follow resumes after the last id it applied.
    readings.keys[0]!.listener({ kind: "stale", key: "k" });
    expect(readings.keys[0]!.released).toBe(true);
    expect(readings.keys[1]!.request).toEqual({ kind: "thread", thread: "th 1", after: 42 });
    // A second fence with nothing new keeps the key: no churn.
    readings.keys[1]!.listener({ kind: "stale", key: "k" });
    expect(readings.keys).toHaveLength(2);

    readings.emit(1, 6, 42); // a replay across the reconnect: skipped
    readings.emit(1, 7, 43);
    expect(seen).toEqual([5, 6, 7]);

    // A hole in seq: re-read the body; this follow is done.
    readings.emit(1, 9, 45);
    expect([rereads, readings.keys[1]!.released]).toEqual([1, true]);
    readings.keys[1]!.listener({ kind: "stale", key: "k" });
    readings.emit(1, 10, 46);
    expect([readings.keys.length, seen]).toEqual([2, [5, 6, 7]]);
    stop();
  });
  it("a gap ends the follow with a reread, and a stop releases its key", () => {
    const readings = new FakeReadings();
    let rereads = 0;
    streamThread({ threadId: "th 1", cursor: 40, lastSeq: 4, readings, onEvent: () => {}, onReread: () => rereads++ });
    readings.keys[0]!.listener({ kind: "gap", key: "k", dropped: null, id: 90 });
    expect([rereads, readings.keys[0]!.released]).toEqual([1, true]);
    const stop = streamThread({ threadId: "th 1", cursor: 90, lastSeq: 4, readings, onEvent: () => {}, onReread: () => rereads++ });
    stop();
    expect(readings.keys[1]!.released).toBe(true);
  });
});
