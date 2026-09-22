/**
 * Freshness is a per-document change mark, held by the host (design-system ledger, 2026-09-22).
 * The host derives it once, against when the Reading it serves was taken, and republishes the
 * envelope; no consumer compares clocks and no consumer can miss the fact by missing an event.
 */
import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import type { ReadingFrame } from "@pe/agent-contracts";
import type { HostBridgeEvent, RevitBridge } from "../src/bridge.ts";
import { documentMarks } from "../src/document-marks.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";

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
