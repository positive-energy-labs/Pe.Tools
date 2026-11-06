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
    request: sceneRequest([101], true, 15, "none"),
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

it("preserves a capture failure and its validation issues without a fallback read", async () => {
  const error = new HostCallError("invalid", 422, {
    issues: [{ path: "region", message: "required" }],
  });
  io.call.mockRejectedValue(error);
  const data = sceneData({
    kind: "capture",
    document: { session: "error", openId: "doc" },
    revision: "invalid",
    request: sceneRequest([101], false, 0, "overview"),
  });
  const release = data.subscribe(() => {});
  await vi.waitFor(() => expect(data.read().state).toBe("failed"));
  expect(data.read()).toEqual({ state: "failed", error });
  expect(io.call).toHaveBeenCalledTimes(1);
  release();
});
it("delivers an explicitly requested scene after 151 seconds without abandoning or reissuing it", async () => {
  vi.useFakeTimers();
  io.call.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve({ id: "slow-151" }), 151_000)),
  );
  const data = sceneData({
    kind: "capture",
    document: { session: "slow-151", openId: "doc" },
    revision: 1,
    request: sceneRequest([101], false, 15, "meshes"),
  });
  const release = data.subscribe(() => {});
  try {
    await vi.advanceTimersByTimeAsync(120_001);
    expect(data.read().state).toBe("pending");
    expect(io.call.mock.calls[0]![2].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_999);
    expect(data.read().state).toBe("ready");
    expect(io.call).toHaveBeenCalledTimes(1);
    expect(io.fetch).toHaveBeenCalledWith("slow-151", expect.any(AbortSignal));
  } finally {
    release();
    await vi.advanceTimersByTimeAsync(0);
  }
});

it("the last reader leaving aborts the client wait and ignores a late native answer", async () => {
  vi.useFakeTimers();
  let answer!: (value: { id: string }) => void;
  io.call.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const data = sceneData({
    kind: "capture",
    document: { session: "leave-slow", openId: "doc" },
    revision: 1,
    request: sceneRequest([101], false, 15, "meshes"),
  });
  const first = data.subscribe(() => {});
  const last = data.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  const signal = io.call.mock.calls[0]![2].signal as AbortSignal;
  first();
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(false);
  last();
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(true);
  const fetched = io.fetch.mock.calls.length;
  answer({ id: "abandoned" });
  await vi.advanceTimersByTimeAsync(0);
  expect(io.fetch).toHaveBeenCalledTimes(fetched);
  expect(data.read().state).toBe("pending");
});

it("supersedes unsent selections and releases a dispatched detailed read before the replacement", async () => {
  vi.useFakeTimers();
  const answers: ((value: { id: string }) => void)[] = [];
  io.call.mockImplementation(() => new Promise(resolve => answers.push(resolve)));
  const source = (ids: number[], representation: "overview" | "meshes" = "overview") => sceneData({
    kind: "capture", document: { session: "supersede", openId: "doc" }, revision: 1,
    request: sceneRequest(ids, false, 15, representation),
  });
  const first = source([1]).subscribe(() => {});
  first();
  const second = source([1, 2]).subscribe(() => {});
  second();
  const detailed = source([1, 2, 3], "meshes").subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(io.call).toHaveBeenCalledTimes(1);
  const signal = io.call.mock.calls[0]![2].signal as AbortSignal;
  detailed();
  const latest = source([4]);
  const release = latest.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(true);
  expect(io.call).toHaveBeenCalledTimes(2);
  const fetches = io.fetch.mock.calls.length;
  answers[0]!({ id: "stale-detail" });
  await vi.advanceTimersByTimeAsync(0);
  expect(io.fetch).toHaveBeenCalledTimes(fetches);
  answers[1]!({ id: "latest-overview" });
  await vi.advanceTimersByTimeAsync(0);
  expect(latest.read().state).toBe("ready");
  release();
  await vi.advanceTimersByTimeAsync(0);
});
