// @vitest-environment jsdom
import { HostCallError } from "@pe/host-contracts/operation-types";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { sceneRequest } from "./host";
import { sceneData } from "./scene-data";

const io = vi.hoisted(() => ({
  call: vi.fn(),
  fetch: vi.fn(async () => new ArrayBuffer(0)),
}));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("./artifact", () => ({ fetchSceneArtifact: io.fetch }));
vi.mock("./psc1", () => ({
  SCENE_FORMAT: "space-scene-v2",
  decodeScene: () => ({
    meshes: { instances: [], positions: new Float32Array(0) },
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

afterEach(() => {
  io.call.mockReset();
  vi.useRealTimers();
});

const queueFull = () =>
  new HostCallError(
    "revit.detail.space-scene: Revit queue is full (8 waiting). Retry 'revit.detail.space-scene' shortly.",
    423,
    { kind: "BridgeBusy", operationKey: "revit.detail.space-scene", status: 423 },
  );

it("resends a read refused by a full Revit queue with 1 s then 2 s backoff, then follows the artifact", async () => {
  vi.useFakeTimers();
  io.call
    .mockRejectedValueOnce(queueFull())
    .mockRejectedValueOnce(queueFull())
    .mockResolvedValueOnce({ id: "artifact-queue" });
  const data = sceneData({
    kind: "capture",
    document: { session: "queue-session", openId: "queue-doc" },
    revision: "queue-revision",
    request: sceneRequest([101]),
  });
  const unsubscribe = data.subscribe(() => {});

  await vi.advanceTimersByTimeAsync(0);
  expect(io.call).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(io.call).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(io.call).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(io.call).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(0);
  expect(io.fetch).toHaveBeenCalledWith("artifact-queue", expect.any(AbortSignal));
  expect(data.read().state).toBe("ready");
  unsubscribe();
});
