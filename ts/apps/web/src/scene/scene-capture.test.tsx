// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { sceneRequest } from "./host";
import { useCapture } from "#/scene/picture/read";

const native = vi.hoisted(() => ({
  calls: [] as {
    request: {
      elementIds: number[];
      focusOnly: boolean;
      contextPaddingFt: number;
      proximity: boolean;
      contextRepresentation: "none" | "boxes" | "meshes";
    };
    resolve: (value: { id: string }) => void;
    reject: (error: Error) => void;
  }[],
}));
vi.mock("#/host/client", () => ({
  callHostRpc: vi.fn(
    (_key, request) =>
      new Promise((resolve, reject) => native.calls.push({ request, resolve, reject })),
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
  await act(async () => native.calls[index]!.resolve({ id }));
};

it("context representation changes retain exact focus and never reuse incompatible coverage", async () => {
  const view = renderHook(
    ({ representation }: { representation: "boxes" | "meshes" }) =>
      useCapture(sceneRequest([7199], false, 10, representation), doc, "representation"),
    { initialProps: { representation: "boxes" } },
  );
  expect(native.calls[0]!.request.contextRepresentation).toBe("none");
  await finish(0, "representation-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(native.calls[1]!.request.contextRepresentation).toBe("boxes");
  await finish(1, "representation-boxes");
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
  view.rerender({ representation: "boxes" });
  await waitFor(() =>
    expect(view.result.current.meshes).toMatchObject({ id: "representation-boxes" }),
  );
  expect(native.calls).toHaveLength(3);
});

it("shows exact focus before context, keeps it inspectable, and does not recapture on visual renders or shrink", async () => {
  const view = renderHook(
    ({ radius, epoch }) => useCapture(sceneRequest([7121], false, radius), doc, epoch),
    { initialProps: { radius: 10, epoch: 3 } },
  );
  expect(native.calls).toHaveLength(1);
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
  expect(native.calls).toHaveLength(2);
  expect(view.result.current.meshes).toMatchObject({ id: "context-ten" });
  view.rerender({ radius: 20, epoch: 3 });
  expect(native.calls).toHaveLength(3);
  expect(native.calls[2]!.request.contextPaddingFt).toBe(20);
  expect(view.result.current).toMatchObject({ meshes: { id: "focus-first" }, focusReady: true });
});

it("fences late scopes and revisions", async () => {
  const view = renderHook(
    ({ ids, epoch }) => useCapture(sceneRequest(ids, false, 10), doc, epoch),
    { initialProps: { ids: [7122], epoch: 0 } },
  );
  await finish(0, "old-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  view.rerender({ ids: [7123], epoch: 0 });
  expect(native.calls).toHaveLength(3);
  await finish(1, "late-context");
  expect(view.result.current.meshes).toBeNull();
  await finish(2, "new-focus");
  await waitFor(() => expect(native.calls).toHaveLength(4));
  view.rerender({ ids: [7123], epoch: 1 });
  expect(native.calls).toHaveLength(5);
  expect(native.calls[4]!.request.focusOnly).toBe(true);
  await finish(3, "late-reach");
  expect(view.result.current.meshes).toBeNull();
});

it("shares identical in-flight reads and fences a replacement document", async () => {
  const request = sceneRequest([7124], false, 10);
  const first = renderHook(() => useCapture(request, doc, "snapshot-a"));
  const second = renderHook(({ target }) => useCapture(request, target, "snapshot-a"), {
    initialProps: { target: doc },
  });
  expect(native.calls).toHaveLength(1);
  await finish(0, "shared-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  expect(first.result.current.focusReady).toBe(true);
  expect(second.result.current.focusReady).toBe(true);
  second.rerender({ target: { ...doc, openId: "replacement" } });
  expect(native.calls).toHaveLength(3);
  await finish(1, "previous-document-context");
  expect(second.result.current.meshes).toBeNull();
  await waitFor(() => expect(first.result.current.pending).toBe(false));
});

it("reuses A/B/A and remounts at the same native revision, but expansion and revision changes read", async () => {
  const hook = ({ id, radius, revision }: { id: number; radius: number; revision: string }) =>
    useCapture(sceneRequest([id], false, radius), doc, revision);
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
  expect(native.calls).toHaveLength(4);
  view.unmount();
  const remount = renderHook(hook, { initialProps: { id: 7130, radius: 10, revision: "reuse-a" } });
  expect(remount.result.current.pending).toBe(false);
  expect(native.calls).toHaveLength(4);
  remount.rerender({ id: 7130, radius: 20, revision: "reuse-a" });
  expect(native.calls).toHaveLength(5);
  expect(native.calls[4]!.request.contextPaddingFt).toBe(20);
  remount.rerender({ id: 7130, radius: 20, revision: "reuse-b" });
  expect(native.calls).toHaveLength(6);
  expect(native.calls[5]!.request.focusOnly).toBe(true);
});

it("keeps a limited expansion usable without retrying or promoting it over complete smaller coverage", async () => {
  const hook = ({ radius }: { radius: number }) =>
    useCapture(sceneRequest([7140], false, radius), doc, "limited-context");
  const view = renderHook(hook, { initialProps: { radius: 10 } });
  await finish(0, "limited-proof-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  await finish(1, "complete-small-context");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  view.rerender({ radius: 20 });
  expect(native.calls).toHaveLength(3);
  await finish(2, "limited-large-context");
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current).toMatchObject({
    meshes: { id: "limited-large-context" },
    focusReady: true,
    error: null,
    completeness: { complete: false, deferredCandidates: 20 },
  });
  view.rerender({ radius: 20 });
  expect(native.calls).toHaveLength(3);
  view.rerender({ radius: 5 });
  expect(view.result.current).toMatchObject({
    meshes: { id: "complete-small-context" },
    completeness: { complete: true },
    pending: false,
  });
  expect(native.calls).toHaveLength(3);
  view.rerender({ radius: 20 });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.completeness?.complete).toBe(false);
  expect(native.calls).toHaveLength(3);
  view.unmount();
  const remount = renderHook(hook, { initialProps: { radius: 20 } });
  await waitFor(() => expect(remount.result.current.pending).toBe(false));
  expect(remount.result.current.focusReady).toBe(true);
  expect(remount.result.current.completeness?.complete).toBe(false);
  expect(native.calls).toHaveLength(3);
});

it("reports failed optional context separately from the usable focus", async () => {
  const view = renderHook(() =>
    useCapture(sceneRequest([7141], false, 10), doc, "context-failure"),
  );
  await finish(0, "context-failure-focus");
  await waitFor(() => expect(native.calls).toHaveLength(2));
  await act(async () => native.calls[1]!.reject(new Error("context could not be acquired")));
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current).toMatchObject({
    meshes: { id: "context-failure-focus" },
    focusReady: true,
    error: null,
    contextError: "Error: context could not be acquired",
  });
});
