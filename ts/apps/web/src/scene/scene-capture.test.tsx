// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { sceneRequest, type ContextRepresentation } from "./host";
import { useCapture } from "#/scene/picture/read";

const native = vi.hoisted(() => ({
  calls: [] as {
    request: ReturnType<typeof sceneRequest>;
    signal: AbortSignal;
    resolve: (value: { id: string }) => void;
    reject: (error: Error) => void;
  }[],
}));
vi.mock("#/host/client", () => ({
  callHostRpc: vi.fn(
    (_key, request, options) =>
      new Promise((resolve, reject) => native.calls.push({ request, signal: options.signal, resolve, reject })),
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
      completeness: new TextDecoder().decode(buffer).startsWith("limited-")
        ? {
            complete: false,
            deferredCandidates: 20,
            acquisitionLimitedElements: 2,
            limitReason: "memory-headroom",
          }
        : {
            complete: true,
            deferredCandidates: 0,
            acquisitionLimitedElements: 0,
            limitReason: null,
          },
    },
  }),
}));
afterEach(() => {
  cleanup();
  native.calls.length = 0;
});
const doc = { session: "capture-proof", openId: "doc" };
const finish = async (index: number, id: string) => {
  await waitFor(() => expect(native.calls[index]).toBeDefined());
  await act(async () => native.calls[index]!.resolve({ id }));
};

it("context representation changes retain exact focus and never reuse incompatible coverage", async () => {
  const view = renderHook(
    ({ representation }: { representation: Exclude<ContextRepresentation, "none"> }) =>
      useCapture(sceneRequest([7199], false, 10, representation), doc, "representation"),
    { initialProps: { representation: "oriented" } },
  );
  await waitFor(() => expect(native.calls[0]).toBeDefined());
  expect(native.calls[0]!.request.contextRepresentation).toBe("none");
  await finish(0, "representation-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(native.calls[1]!.request.contextRepresentation).toBe("oriented");
  await finish(1, "representation-oriented");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  const focus = view.result.current.focusMeshes;
  view.rerender({ representation: "meshes" });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  expect(native.calls[2]!.request).toMatchObject({
    focusOnly: false,
    contextRepresentation: "meshes",
  });
  expect(view.result.current.focusMeshes).toBe(focus);
  await finish(2, "representation-meshes");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ representation: "triangle-boxes" });
  await waitFor(() => expect(native.calls).toHaveLength(4));
  expect(native.calls[3]!.request.contextRepresentation).toBe("triangle-boxes");
  expect(view.result.current.focusMeshes).toBe(focus);
  await finish(3, "representation-triangle-boxes");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ representation: "oriented" });
  await waitFor(() =>
    expect(view.result.current.meshes).toMatchObject({ id: "representation-oriented" }),
  );
  await waitFor(() => expect(native.calls).toHaveLength(4));
});

it("shows exact focus before context, keeps it inspectable, and does not recapture on visual renders or shrink", async () => {
  const view = renderHook(
    ({ radius, epoch }) =>
      useCapture(sceneRequest([7121], false, radius, "link-boxes"), doc, epoch),
    { initialProps: { radius: 10, epoch: 3 } },
  );
  await waitFor(() => expect(native.calls).toHaveLength(1));
  expect(native.calls[0]!.request.focusOnly).toBe(true);
  await finish(0, "focus-first");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(view.result.current).toMatchObject({
    meshes: { id: "focus-first" },
    focusReady: true,
    pending: true,
  });
  await finish(1, "context-ten");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ radius: 10, epoch: 3 });
  view.rerender({ radius: 5, epoch: 3 });
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(view.result.current.meshes).toMatchObject({ id: "context-ten" });
  view.rerender({ radius: 20, epoch: 3 });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  expect(native.calls[2]!.request.contextPaddingFt).toBe(20);
  expect(view.result.current).toMatchObject({ meshes: { id: "focus-first" }, focusReady: true });
});

it("fences late scopes and revisions", async () => {
  const view = renderHook(
    ({ ids, epoch }) => useCapture(sceneRequest(ids, false, 10, "link-boxes"), doc, epoch),
    { initialProps: { ids: [7122], epoch: 0 } },
  );
  await finish(0, "old-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  view.rerender({ ids: [7123], epoch: 0 });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  await finish(1, "late-context");
  expect(view.result.current.meshes).toBeNull();
  await finish(2, "new-focus");
  await waitFor(() => expect(native.calls).toHaveLength(4));
  view.rerender({ ids: [7123], epoch: 1 });
  await waitFor(() => expect(native.calls).toHaveLength(5));
  expect(native.calls[4]!.request.focusOnly).toBe(true);
  await finish(3, "late-reach");
  expect(view.result.current.meshes).toBeNull();
});

it("shares identical in-flight reads and fences a replacement document", async () => {
  const request = sceneRequest([7124], false, 10, "link-boxes");
  const first = renderHook(() => useCapture(request, doc, "snapshot-a"));
  const second = renderHook(({ target }) => useCapture(request, target, "snapshot-a"), {
    initialProps: { target: doc },
  });
  await waitFor(() => expect(native.calls).toHaveLength(1));
  await finish(0, "shared-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(first.result.current.focusReady).toBe(true);
  expect(second.result.current.focusReady).toBe(true);
  second.rerender({ target: { ...doc, openId: "replacement" } });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  await finish(1, "previous-document-context");
  expect(second.result.current.meshes).toBeNull();
  await waitFor(() => expect(first.result.current.pending).toBe(false));
});

it("reuses A/B/A and remounts at the same native revision, but expansion and revision changes read", async () => {
  const hook = ({ id, radius, revision }: { id: number; radius: number; revision: string }) =>
    useCapture(sceneRequest([id], false, radius, "link-boxes"), doc, revision);
  const view = renderHook(hook, { initialProps: { id: 7130, radius: 10, revision: "reuse-a" } });
  await finish(0, "reuse-focus-a");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  await finish(1, "reuse-context-a");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ id: 7131, radius: 10, revision: "reuse-a" });
  await finish(2, "reuse-focus-b");
  await waitFor(() => expect(native.calls).toHaveLength(4));
  await finish(3, "reuse-context-b");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ id: 7130, radius: 5, revision: "reuse-a" });
  expect(view.result.current).toMatchObject({ meshes: { id: "reuse-context-a" }, pending: false });
  await waitFor(() => expect(native.calls).toHaveLength(4));
  view.unmount();
  const remount = renderHook(hook, { initialProps: { id: 7130, radius: 10, revision: "reuse-a" } });
  expect(remount.result.current.pending).toBe(false);
  await waitFor(() => expect(native.calls).toHaveLength(4));
  remount.rerender({ id: 7130, radius: 20, revision: "reuse-a" });
  await waitFor(() => expect(native.calls).toHaveLength(5));
  expect(native.calls[4]!.request.contextPaddingFt).toBe(20);
  remount.rerender({ id: 7130, radius: 20, revision: "reuse-b" });
  await waitFor(() => expect(native.calls).toHaveLength(6));
  expect(native.calls[5]!.request.focusOnly).toBe(true);
});

it("keeps a limited expansion usable without retrying or promoting it over complete smaller coverage", async () => {
  const hook = ({ radius }: { radius: number }) =>
    useCapture(sceneRequest([7140], false, radius, "link-boxes"), doc, "limited-context");
  const view = renderHook(hook, { initialProps: { radius: 10 } });
  await finish(0, "limited-proof-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  await finish(1, "complete-small-context");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ radius: 20 });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  await finish(2, "limited-large-context");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current).toMatchObject({
    meshes: { id: "limited-large-context" },
    focusReady: true,
    error: null,
    completeness: { complete: false, deferredCandidates: 20 },
  });
  view.rerender({ radius: 20 });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  view.rerender({ radius: 5 });
  expect(view.result.current).toMatchObject({
    meshes: { id: "complete-small-context" },
    completeness: { complete: true },
    pending: false,
  });
  await waitFor(() => expect(native.calls).toHaveLength(3));
  view.rerender({ radius: 20 });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.completeness?.complete).toBe(false);
  await waitFor(() => expect(native.calls).toHaveLength(3));
  view.unmount();
  const remount = renderHook(hook, { initialProps: { radius: 20 } });
  await waitFor(() => expect(remount.result.current.pending).toBe(false));
  expect(remount.result.current.focusReady).toBe(true);
  expect(remount.result.current.completeness?.complete).toBe(false);
  await waitFor(() => expect(native.calls).toHaveLength(3));
});

it("reports failed optional context separately from the usable focus", async () => {
  const view = renderHook(() =>
    useCapture(sceneRequest([7141], false, 10, "link-boxes"), doc, "context-failure"),
  );
  await finish(0, "context-failure-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  await act(async () => native.calls[1]!.reject(new Error("context could not be acquired")));
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current).toMatchObject({
    meshes: { id: "context-failure-focus" },
    focusReady: true,
    error: null,
    contextError: expect.objectContaining({ message: "context could not be acquired" }),
  });
});

it("overview completes in one zero-tessellation read without focus warming", async () => {
  const request = sceneRequest([7199], false, 15, "overview");
  const view = renderHook(() => useCapture(request, doc, "overview-default"));
  await waitFor(() => expect(native.calls[0]).toBeDefined());
  expect(native.calls[0]!.request).toEqual(request);
  await finish(0, "overview-scene");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  await waitFor(() => expect(native.calls).toHaveLength(1));
  expect(sceneRequest([7199], true, 15, "overview").contextRepresentation).toBe("overview");
});

it("detailed focus and context each retain at least five feet", async () => {
  renderHook(() => useCapture(sceneRequest([91571], false, 2, "meshes"), doc, "padding-minimum"));
  await waitFor(() => expect(native.calls).toHaveLength(1));
  expect(native.calls[0]!.request.contextPaddingFt).toBe(5);
  await finish(0, "padding-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(native.calls[1]!.request.contextPaddingFt).toBe(5);
});

it("uses the overview focus bounds while one detailed read replaces it without a none read", async () => {
  const overview = sceneRequest([8881], false, 0, "overview");
  const detail = sceneRequest([8881, 8882], false, 10, "meshes");
  const view = renderHook(({ detailed }) => useCapture(detailed ? detail : overview, doc, "overview-to-detail", undefined, overview), { initialProps: { detailed: false } });
  await finish(0, "overview-staged");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  const meshes = view.result.current.meshes;
  view.rerender({ detailed: true });
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(native.calls.map(call => call.request.contextRepresentation)).toEqual(["overview", "meshes"]);
  expect(view.result.current.meshes).toBe(meshes);
  expect(view.result.current.focusMeshes).toBe(meshes);
  expect(view.result.current.focusReady).toBe(true);
  await finish(1, "detailed-replacement");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.meshes).toMatchObject({ id: "detailed-replacement" });
  expect(native.calls).toHaveLength(2);
});

it("Read detailed releases an unfinished overview rather than queueing behind it", async () => {
  const overview = sceneRequest([8891], false, 0, "overview");
  const detail = sceneRequest([8891], false, 10, "meshes");
  const view = renderHook(({ detailed }) => useCapture(detailed ? detail : overview, doc, "superseded-overview", undefined, overview), { initialProps: { detailed: false } });
  await waitFor(() => expect(native.calls).toHaveLength(1));
  view.rerender({ detailed: true });
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(native.calls[0]!.signal.aborted).toBe(true);
  await finish(1, "explicit-detail");
  await finish(0, "stale-overview");
  expect(view.result.current.meshes).toMatchObject({ id: "explicit-detail" });
  expect(native.calls.map(call => call.request.contextRepresentation)).toEqual(["overview", "meshes"]);
});
