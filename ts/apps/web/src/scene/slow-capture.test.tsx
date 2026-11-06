// @vitest-environment jsdom
/**
 * The 2026-10-31 re-capture loop, without Revit. A native scene read that outlives the Readings
 * deadline must be asked once and never abandoned. Revit runs one op at a time, so while the
 * capture runs, a reading that needs Revit stays unanswered; that slowness must not fault a wire
 * that is delivering other readings. A faulted wire fences the document snapshot, the snapshot
 * gate drops the capture's document (`ducts/route.tsx` `captureSource`), the capture aborts, and
 * the reconnect re-issues the identical read, once per deadline, forever.
 *
 * Real `PeReadings` over stand-in EventSource and subscription updater, and real `useCapture`;
 * the host RPC is stubbed and never answers the capture during the test.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { readingFrameSchema, readingKey } from "@pe/agent-contracts";
import { PeReadings } from "#/readings";
import { useCapture } from "#/scene/picture/read";
import { sceneRequest } from "./host";

const native = vi.hoisted(() => ({
  calls: [] as {
    request: { focusOnly: boolean; contextRepresentation: string };
    signal: AbortSignal;
    resolve: (value: { id: string }) => void;
  }[],
}));
vi.mock("#/host/client", () => ({
  callHostRpc: vi.fn(
    (_key: string, request: never, options: { signal: AbortSignal }) =>
      new Promise((resolve) => native.calls.push({ request, signal: options.signal, resolve })),
  ),
}));
vi.mock("./artifact", () => ({
  fetchSceneArtifact: async (id: string) => new TextEncoder().encode(id).buffer,
}));
vi.mock("./psc1", () => ({
  SCENE_FORMAT: "space-scene-v2",
  decodeScene: (buffer: ArrayBuffer) => ({
    meshes: { id: new TextDecoder().decode(buffer), instances: [], positions: new Float32Array(0) },
    metadata: {
      elements: [],
      stamp: { sources: [] },
      omittedElements: 0,
      unavailableElements: [],
      completeness: {
        complete: true,
        deferredCandidates: 0,
        acquisitionLimitedElements: 0,
        limitReason: null,
      },
    },
  }),
}));

type Fake = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  closed: boolean;
  close: () => void;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  native.calls.length = 0;
});

it("a native capture slower than the reading deadline is asked once and never abandoned", async () => {
  vi.useFakeTimers();
  const sources: Fake[] = [];
  const readings = new PeReadings(
    () => "http://127.0.0.1:5180/readings",
    () => {
      const source: Fake = {
        onopen: null,
        onmessage: null,
        onerror: null,
        closed: false,
        close: () => void (source.closed = true),
      };
      sources.push(source);
      return source as unknown as EventSource;
    },
    (deliver) => {
      deliver();
      return () => {};
    },
    async () => {},
  );
  // Stand-ins: the document snapshot the capture is gated on, and a reading whose owner waits on
  // Revit's queue behind the capture (the snapshot and catalog readings of the observation).
  const snapshot = { kind: "thread-head", thread: "document-snapshot" } as const;
  const starved = { kind: "machine" } as const;
  const doc = { session: "slow-capture", openId: "doc" };
  const { unmount } = renderHook(() => {
    // `readings-use.ts`: a stale frame makes the reading not current; `ducts/route.tsx` then
    // withdraws `captureSource`, and the Picture's capture loses its document.
    const [current, setCurrent] = useState(false);
    useEffect(
      () =>
        readings.subscribe(snapshot, (frame) =>
          setCurrent(frame.kind === "snapshot" && !frame.stale),
        ),
      [],
    );
    useEffect(() => readings.subscribe(starved, () => {}), []);
    return useCapture(sceneRequest([7199], false, 15, "meshes"), current ? doc : null, "v1");
  });
  const deliver = (source: Fake) =>
    act(() =>
      source.onmessage!({
        data: JSON.stringify(
          readingFrameSchema.parse({
            kind: "snapshot",
            key: readingKey(snapshot),
            value: { revision: 1 },
          }),
        ),
      }),
    );
  const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  await elapse(0);
  act(() => sources[0]!.onopen!());
  await deliver(sources[0]!);
  // Exact focus answers at once; the context read is the slow one and never answers here.
  expect(native.calls.map((call) => call.request.contextRepresentation)).toEqual(["none"]);
  await act(async () => native.calls[0]!.resolve({ id: "slow-focus" }));
  await elapse(0);
  expect(native.calls.map((call) => call.request.contextRepresentation)).toEqual([
    "none",
    "meshes",
  ]);
  const capture = native.calls[1]!;

  // Revit keeps reading past the deadline, then a reconnect would have had time to land.
  await elapse(30_001);
  await elapse(1_000);
  if (sources.length > 1) {
    act(() => sources.at(-1)!.onopen!());
    await deliver(sources.at(-1)!);
    await elapse(0);
  }

  expect(sources[0]!.closed, "the wire delivered the snapshot; it is slow, not dead").toBe(false);
  expect(capture.signal.aborted, "the capture was abandoned while Revit ran it").toBe(false);
  expect(
    native.calls.filter((call) => call.request.contextRepresentation === "meshes"),
    "the same read was queued again behind itself",
  ).toHaveLength(1);

  unmount();
  readings.close();
});
