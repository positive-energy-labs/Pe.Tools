// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { sceneRequest } from "./host";
import { useScene, useSceneArtifact } from "./use-scene";

const call = vi.hoisted(() => ({
  data: { id: "partial-context" },
  pending: false,
  error: null,
  refresh: vi.fn(),
}));
vi.mock("#/readings", () => ({ useHostOp: () => call }));
const io = vi.hoisted(() => ({
  fetch: vi.fn<(id: string, signal?: AbortSignal) => Promise<ArrayBuffer>>(),
  decode: vi.fn(),
}));
io.fetch.mockImplementation(async () => new ArrayBuffer(0));
vi.mock("./artifact", () => ({ fetchSceneArtifact: io.fetch }));
// Hook wiring only: PSC1 decoding has its own binary tests; no native capture or browser layout.
vi.mock("./psc1", () => ({
  decodeScene: io.decode.mockImplementation(() => ({
    meshes: { instances: [], positions: new Float32Array(0) },
    metadata: {
      elements: [],
      stamp: { sources: [] },
      omittedElements: 11636,
      unavailableElements: [{ elementId: 42 }],
    },
  })),
}));

afterEach(cleanup);

function deferred() {
  let resolve!: (data: ArrayBuffer) => void;
  const promise = new Promise<ArrayBuffer>((done) => (resolve = done));
  return { promise, resolve };
}

it("forwards capture completeness with the decoded meshes and clears it for an idle request", async () => {
  const request = sceneRequest([71], false);
  const view = renderHook(
    ({ active }) => useScene(active ? request : null, { session: "test", openId: "doc" }, 0),
    { initialProps: { active: true } },
  );
  expect(view.result.current).toMatchObject({
    pending: true,
    omittedElements: 0,
    unavailableElements: 0,
  });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current).toMatchObject({
    meshes: { instances: [] },
    omittedElements: 11636,
    unavailableElements: 1,
  });
  view.rerender({ active: false });
  expect(view.result.current).toMatchObject({
    meshes: null,
    omittedElements: 0,
    unavailableElements: 0,
  });
  view.unmount();
});

it("shares a download and decoded identity, and one consumer cannot abort another", async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  io.fetch.mockImplementationOnce((_, s) => {
    signal = s;
    return pending.promise;
  });
  const before = io.fetch.mock.calls.length;
  const first = renderHook(() => useSceneArtifact("shared-active"));
  const second = renderHook(() => useSceneArtifact("shared-active"));
  expect(io.fetch.mock.calls.length - before).toBe(1);
  first.unmount();
  await act(async () => {});
  expect(signal?.aborted).toBe(false);
  await act(async () => pending.resolve(new ArrayBuffer(0)));
  expect(second.result.current.pending).toBe(false);
  // Evict the settled scene from the bounded LRU while its second consumer still owns it.
  for (const id of ["evict-1", "evict-2", "evict-3"]) {
    const filler = renderHook(() => useSceneArtifact(id));
    await waitFor(() => expect(filler.result.current.pending).toBe(false));
    filler.unmount();
  }
  const count = io.fetch.mock.calls.length;
  const third = renderHook(() => useSceneArtifact("shared-active"));
  await waitFor(() => expect(third.result.current.pending).toBe(false));
  expect(io.fetch.mock.calls.length).toBe(count);
  expect(third.result.current.meshes).toBe(second.result.current.meshes);
});

it("aborts the final consumer and never decodes, caches, or publishes a late response", async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  io.fetch.mockImplementationOnce((_, s) => {
    signal = s;
    return pending.promise;
  });
  const view = renderHook(({ id }) => useSceneArtifact(id), {
    initialProps: { id: "abandoned" as string | null },
  });
  view.rerender({ id: null });
  await act(async () => {});
  expect(signal?.aborted).toBe(true);
  const decodes = io.decode.mock.calls.length;
  await act(async () => pending.resolve(new ArrayBuffer(0)));
  expect(io.decode.mock.calls.length).toBe(decodes);
  expect(view.result.current).toEqual({
    meshes: null,
    metadata: null,
    error: null,
    pending: false,
  });
  const requests = io.fetch.mock.calls.length;
  view.rerender({ id: "abandoned" });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(io.fetch.mock.calls.length).toBe(requests + 1);
});

it("StrictMode reconnects share the pending request instead of aborting and downloading again", async () => {
  const pending = deferred();
  io.fetch.mockImplementationOnce(() => pending.promise);
  const requests = io.fetch.mock.calls.length;
  const view = renderHook(() => useSceneArtifact("strict-shared"), {
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  });
  expect(io.fetch.mock.calls.length).toBe(requests + 1);
  await act(async () => pending.resolve(new ArrayBuffer(0)));
  expect(view.result.current.pending).toBe(false);
});
