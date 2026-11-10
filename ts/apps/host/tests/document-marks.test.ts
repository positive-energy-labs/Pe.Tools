/**
 * Freshness is a per-document change mark, held by the host (design-system ledger, 2026-09-22).
 * The host derives it once, against when the Reading it serves was taken, and republishes the
 * envelope; no consumer compares clocks and no consumer can miss the fact by missing an event.
 */
import { detachedBridge, captureStore } from "./effect-test.ts";
import { expect, test, vi } from "vite-plus/test";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  bindWork,
  familiesMatrixEnvelopeSchema,
  type ReadingFrame,
} from "@pe/agent-contracts";
import { RevitBridge, type HostBridgeEvent } from "../src/bridge.ts";
import { assertFresh, HostDocumentMarks, STALE_READ } from "../src/document-marks.ts";
import { setup } from "./schedule-recorded-fixture.ts";
import { hostResourceObserver, markReadings } from "../src/resource-adapters.ts";

const A = { session: "S1", openId: "open-A" };

test("mark frames await capture, retain comparison time through queued changes and suppress late completion", async () => {
  const frames: ReadingFrame[] = [];
  const pending: { at?: number; done: (frame: import("../src/document-marks.ts").MarkFrame) => void }[] = [];
  let changed = () => {}, released = 0, unwatched = 0;
  const release = markReadings({
    changedAt: () => { throw Error("A frame must use its Effect input boundary"); },
    subscribe: (notify) => { changed = notify; return () => { unwatched++; }; },
  }, (_ref, _key, at) => new Promise((done) => pending.push({ at, done })))(
    (request, publish) => {
      publish({ kind: "snapshot", key: "frame", value: { target: A } });
      return () => { released++; };
    },
  )({ kind: "schedule-reading", subject: "saved", target: A }, (frame) => frames.push(frame));
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  expect(frames).toEqual([]);
  changed();
  pending[0]!.done({ marks: { changedAt: 0 }, servedAt: 200 });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  expect(frames).toMatchObject([{ changed: false }]);
  expect(pending[1]!.at).toBe(200);
  pending[1]!.done({ marks: { changedAt: 300 }, servedAt: 200 });
  await vi.waitFor(() => expect(frames).toHaveLength(2));
  expect(frames[1]).toMatchObject({ changed: true });
  changed();
  await vi.waitFor(() => expect(pending).toHaveLength(3));
  release();
  pending[2]!.done({ marks: { changedAt: 400 }, servedAt: 200 });
  await Promise.resolve(); await Promise.resolve();
  expect(frames).toHaveLength(2);
  expect([released, unwatched]).toEqual([1, 1]);
});

/** A bridge that is only its event tap and its session view. */
function fakeBridge() {
  const listeners = new Set<(event: HostBridgeEvent) => void>();
  const emit = (event: HostBridgeEvent) => {
    for (const listener of listeners) listener(event);
  };
  return {
    bridge: detachedBridge({
      list: Effect.sync(() => [
        { sessionId: "S1", connected: true },
        { sessionId: "S2", connected: true },
      ]),
      subscribe: (listener: (event: HostBridgeEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: (sessionId?: string) => Effect.sync(() => ({ connected: true, sessionId })),
    }),
    changed: (session: string, ...openIds: string[]) =>
      emit({
        sessionId: session,
        kind: "event",
        eventName: "document-changed",
        payloadJson: JSON.stringify({ changedOpenIds: openIds }),
      }),
    detached: (session: string) => emit({ sessionId: session, kind: "disconnected" }),
    listening: () => listeners.size,
  };
}

/** The marks layer over `bridge` in its own scope; on a TestClock standing at `at`, else the live Clock. */
async function holdMarks(bridge: RevitBridge["Service"], at?: number) {
  const scope = Scope.makeUnsafe();
  const built = Layer.buildWithScope(HostDocumentMarks.layer, scope).pipe(
    Effect.provideService(RevitBridge, bridge),
  );
  // effect-edge: test-runner
  const context = await Effect.runPromise(
    at === undefined
      ? built
      : TestClock.setTime(at).pipe(Effect.andThen(built), Effect.provide(TestClock.layer())),
  );
  return {
    marks: Context.get(context, HostDocumentMarks),
    // effect-edge: test-runner
    close: () => Effect.runSync(Scope.close(scope, Exit.void)),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a restored read from before host observation cannot arm apply", async () => {
  const { marks } = await holdMarks(fakeBridge().bridge);
  const old = new Date(marks.observedSince! - 1).toISOString();
  expect(() => assertFresh(marks, A, old)).toThrow(STALE_READ);
  expect(() => assertFresh(marks, A, "invalid-time")).toThrow(STALE_READ);
  expect(() =>
    assertFresh(marks, A, new Date(marks.observedSince! + 1).toISOString()),
  ).not.toThrow();
});

test("marks stand on the layer's Clock, and closing its scope leaves the bridge", async () => {
  const world = fakeBridge();
  const held = await holdMarks(world.bridge, 5_000);
  expect(held.marks.observedSince).toBe(5_000);
  world.changed("S1", "open-A");
  await held.marks.settled!();
  expect(held.marks.changedAt(A)).toBe(5_000);
  expect(world.listening()).toBe(1);
  held.close();
  expect(world.listening()).toBe(0);
});

test("the envelope carries the mark: served unchanged, republished changed, without a new read", async () => {
  const world = fakeBridge();
  const { marks } = await holdMarks(world.bridge);
  const frames: ReadingFrame[] = [];
  const capture = { id: "c1", target: A, capturedAt: new Date().toISOString() };
  const observe = markReadings(marks, (ref, key, at) => ref ? Effect.runPromise(marks.readFrame(ref, key, at)) : Promise.resolve(null))(
    hostResourceObserver(
      world.bridge,
      undefined as never,
      undefined as never,
      "http://127.0.0.1",
      () => Promise.resolve(new Response(JSON.stringify(capture))),
    ),
  );
  const release = observe({ kind: "schedule-reading", subject: "saved", id: "c1" }, (frame) =>
    frames.push(frame),
  );
  await settle();
  await settle();
  expect(frames).toEqual([
    { kind: "snapshot", key: expect.any(String), value: capture, changed: false },
  ]);

  // Another document's change is not this document's mark.
  world.changed("S1", "open-B");
  await settle();
  expect(frames).toHaveLength(1);

  // This one's is, and it arrives with no second read of the value.
  world.changed("S1", "open-A");
  await settle();
  expect(frames).toHaveLength(2);
  expect(frames[1]).toMatchObject({ kind: "snapshot", value: capture, changed: true });
  release();

  // A released Reading is not republished.
  world.changed("S1", "open-A");
  await settle();
  expect(frames).toHaveLength(2);
});

test.each(["changed", "disconnected"])(
  "a push after %s is refused undispatched over HTTP",
  async (event) => {
    const f = await setup();
    if (event === "changed") await f.revitChanged();
    else await f.bridgeDetached();
    await settle();
    expect(await f.submit()).toMatchObject({ error: event === "changed" ? STALE_READ : expect.stringContaining("No attached Revit session") });
    expect(f.sent.filter((call) => call.key === "schedule.cells.apply")).toEqual([]);
    expect((await f.view()).doc.cells["2::1"].edit.value).toBe("TC-SHARED");
  },
);

test("the families matrix Reading streams an envelope, never the body, and wears the mark", async () => {
  const world = fakeBridge();
  const { marks } = await holdMarks(world.bridge);
  const dir = await mkdtemp(join(tmpdir(), "pe-matrix-envelope-"));
  const captures = captureStore(dir);
  const filter = {
    categoryNames: ["Mechanical Equipment"],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  const frames: ReadingFrame[] = [];
  const release = markReadings(marks, (ref, key, at) => ref ? Effect.runPromise(marks.readFrame(ref, key, at)) : Promise.resolve(null))(
    hostResourceObserver(world.bridge, undefined as never, () => captures),
  )({ kind: "families-matrix", target: A, filter }, (frame) => frames.push(frame));
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(frames[0]).toMatchObject({ kind: "snapshot", value: null });

  // A completed matrix read: a large body goes to disk, an envelope goes to the stream.
  const family = (i: number) => ({
    familyId: i,
    familyUniqueId: `u${i}`,
    familyName: `Family ${i}`,
    typeNames: ["Type 1"],
    parameters: Array.from({ length: 40 }, (_, p) => ({
      definition: { identity: { key: `k${p}`, kind: "FamilyParameter", name: `P${p}` } },
      kind: "FamilyParameter",
      scope: "Type",
      storageType: "String",
      formulaState: "None",
      valuesPerType: { "Type 1": `value ${p}` },
    })),
    issues: [],
    isPartial: false,
    placedInstanceCount: 0,
  });
  const saved = await captures.saveFamilies({
    work: bindWork("families", address("C:/demo.rvt")),
    document: A,
    filter,
    capturedAt: new Date().toISOString(),
    result: { families: Array.from({ length: 200 }, (_, i) => family(i)), issues: [], page: null },
  });
  await vi.waitFor(() => expect(frames).toHaveLength(2));
  const envelope = frames[1] as ReadingFrame & { kind: "snapshot" };
  expect(familiesMatrixEnvelopeSchema.parse(envelope.value)?.bodyVersion).toBe(saved.id);
  expect(envelope.changed).toBe(false);
  const bytes = JSON.stringify(envelope).length;
  expect(JSON.stringify(envelope)).not.toContain("Family 1");
  // Measured: 415 bytes here, against a 1.6 MB body that stays on disk.
  expect(bytes).toBeLessThan(1024);

  world.changed("S1", "open-A");
  await vi.waitFor(() => expect(frames).toHaveLength(3));
  expect(frames[2]).toMatchObject({ value: { bodyVersion: saved.id }, changed: true });
  release();
  await rm(dir, { recursive: true, force: true });
});
