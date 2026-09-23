/**
 * Freshness is a per-document change mark, held by the host (design-system ledger, 2026-09-22).
 * The host derives it once, against when the Reading it serves was taken, and republishes the
 * envelope; no consumer compares clocks and no consumer can miss the fact by missing an event.
 */
import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import type { ReadingFrame } from "@pe/agent-contracts";
import type { HostBridgeEvent, RevitBridge } from "../src/bridge.ts";
import { documentMarks } from "../src/document-marks.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { resourceResponse } from "../../../packages/runtime/src/resource-stream.ts";

const A = { session: "S1", openId: "open-A" };
const B = { session: "S1", openId: "open-B" };

/** A bridge that is only its event tap and its session view. */
function fakeBridge(sdkSessionId?: string) {
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  const emit = (event: HostBridgeEvent) => {
    for (const listener of listeners) listener(event);
  };
  return {
    bridge: {
      list: Effect.sync(() => [
        { sessionId: "S1", sdkSessionId, connected: true },
        { sessionId: "S2", connected: true },
      ]),
      subscribe: (listener: (event: HostBridgeEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: (sessionId?: string) =>
        Effect.sync(() => ({ connected: true, sessionId, sdkSessionId })),
    } as unknown as RevitBridge["Service"],
    changed: (session: string, ...openIds: string[]) =>
      emit({
        sessionId: session,
        kind: "event",
        eventName: "document-changed",
        payloadJson: JSON.stringify({ changedOpenIds: openIds }),
      }),
    detached: (session: string) => emit({ sessionId: session, kind: "disconnected" }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("one event marks every document it names, and nothing it does not", async () => {
  const world = fakeBridge();
  const marks = documentMarks(world.bridge);
  expect(marks.changedAt(A)).toBeNull();

  world.changed("S1", "open-A", "open-B");
  await settle();
  expect(marks.changedAt(A)).toBeGreaterThan(0);
  expect(marks.changedAt(B)).toBeGreaterThan(0);
  expect(marks.changedAt({ session: "S1", openId: "open-C" })).toBeNull();
  expect(marks.changedAt({ session: "S2", openId: "open-A" })).toBeNull();
});

test("a Target names either session id: the broker's or pe-revit's", async () => {
  const world = fakeBridge("sdk-7");
  const marks = documentMarks(world.bridge);
  world.changed("S1", "open-A");
  await settle();
  expect(marks.changedAt(A)).toBeGreaterThan(0);
  expect(marks.changedAt({ session: "sdk-7", openId: "open-A" })).toBeGreaterThan(0);
});

test("a detached bridge marks the whole session: we are blind, so every read is changed", async () => {
  const world = fakeBridge();
  const marks = documentMarks(world.bridge);
  world.detached("S1");
  await settle();
  expect(marks.changedAt(A)).toBeGreaterThan(0);
  expect(marks.changedAt(B)).toBeGreaterThan(0);
  expect(marks.changedAt({ session: "S2", openId: "open-A" })).toBeNull();
});

test("the envelope carries the mark: served unchanged, republished changed, without a new read", async () => {
  const world = fakeBridge();
  const marks = documentMarks(world.bridge);
  const frames: ReadingFrame[] = [];
  const observe = hostResourceObserver(
    world.bridge,
    undefined as never,
    undefined as never,
    "http://127.0.0.1",
    () => Promise.reject(Error("no read")),
    marks,
  );
  const release = observe({ kind: "document-mark", target: A }, (frame) => frames.push(frame));
  await settle();
  expect(frames).toEqual([
    { kind: "snapshot", key: expect.any(String), value: {}, changed: false },
  ]);

  // Another document's change is not this document's mark.
  world.changed("S1", "open-B");
  await settle();
  expect(frames).toHaveLength(1);

  // This one's is, and it arrives with no second read of the value.
  world.changed("S1", "open-A");
  await settle();
  expect(frames).toHaveLength(2);
  expect(frames[1]).toMatchObject({ kind: "snapshot", value: {}, changed: true });
  release();

  // A released Reading is not republished.
  world.changed("S1", "open-A");
  await settle();
  expect(frames).toHaveLength(2);
});

test("a stored capture keeps its own taken-at: re-serving it after a gap does not say current", async () => {
  const world = fakeBridge();
  const marks = documentMarks(world.bridge);
  const capture = {
    id: "c1",
    target: A,
    capturedAt: new Date(Date.now() - 60_000).toISOString(),
    snapshot: { takenAt: new Date(Date.now() - 60_000).toISOString() },
  };
  world.changed("S1", "open-A");
  await settle();

  const frames: ReadingFrame[] = [];
  // The client reconnected and subscribed again; the host serves the same stored capture.
  hostResourceObserver(
    world.bridge,
    undefined as never,
    undefined as never,
    "http://127.0.0.1",
    () => Promise.resolve(new Response(JSON.stringify(capture))),
    marks,
  )({ kind: "schedule-reading", subject: "saved", id: "c1" }, (frame) => frames.push(frame));
  await settle();
  await settle();
  expect(frames.at(-1)).toMatchObject({ kind: "snapshot", changed: true });
});

test("host resource drops broker and SDK marks when a disconnected session leaves inventory", async () => {
  const writes = vi.spyOn(Map.prototype, "set");
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  let sessions = [
    { sessionId: "S1", sdkSessionId: "sdk-1", connected: true },
    { sessionId: "S2", sdkSessionId: "sdk-2", connected: true },
  ];
  const bridge = {
    list: Effect.sync(() => sessions),
    snapshot: (id: string) =>
      Effect.sync(() => sessions.find((session) => session.sessionId === id)!),
    subscribe: (listener: (event: HostBridgeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RevitBridge["Service"];
  const marks = documentMarks(bridge);
  const observe = hostResourceObserver(bridge, undefined, undefined, undefined, undefined, marks);
  const response = resourceResponse(
    new Request(
      `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "document-mark", target: A }]))}`,
    ),
    observe,
  );
  const reader = response.body!.getReader();
  const frames: ReadingFrame[] = [];
  const collecting = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      frames.push(JSON.parse(new TextDecoder().decode(next.value).slice(6)));
    }
  })();
  const emit = (event: HostBridgeEvent) => {
    for (const listener of listeners) listener(event);
  };
  try {
    await expect.poll(() => frames.length).toBe(1);
    emit({
      kind: "event",
      sessionId: "S2",
      eventName: "document-changed",
      payloadJson: JSON.stringify({ changedOpenIds: ["other"] }),
    });
    await expect.poll(() => marks.changedAt({ session: "S2", openId: "other" })).not.toBeNull();
    // Inspect retention without adding a diagnostic API to the product's mark owner.
    const held =
      writes.mock.contexts[
        writes.mock.calls.findIndex(([key, value]) => key === "S2" && value instanceof Map)
      ]!;
    writes.mockRestore();
    if (!(held instanceof Map)) throw Error("Session mark map was not retained");
    const priorSize = held.size;
    const prior = marks.changedAt({ session: "S2", openId: "other" });
    emit({
      kind: "event",
      sessionId: "S1",
      eventName: "document-changed",
      payloadJson: JSON.stringify({ changedOpenIds: ["open-A", "open-B"] }),
    });
    await expect.poll(() => frames.at(-1)).toMatchObject({ changed: true });
    sessions[0]!.connected = false;
    emit({ kind: "disconnected", sessionId: "S1" });
    await expect.poll(() => marks.changedAt({ session: "sdk-1", openId: "unread" })).not.toBeNull();
    sessions = sessions.slice(1);
    emit({ kind: "state-sync", sessionId: "S2" });
    await expect.poll(() => frames.at(-1)).toMatchObject({ changed: false });
    for (const session of ["S1", "sdk-1"])
      for (const openId of ["open-A", "open-B", "unread"])
        expect(marks.changedAt({ session, openId })).toBeNull();
    expect(marks.changedAt({ session: "S2", openId: "other" })).toBe(prior);
    expect(held.size).toBe(priorSize);
  } finally {
    writes.mockRestore();
    await reader.cancel();
    await collecting;
  }
});
