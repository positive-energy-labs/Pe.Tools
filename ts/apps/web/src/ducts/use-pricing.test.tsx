// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { SCENE_FIXTURE } from "./scene.fixture";
import {
  pricingJob,
  type PricingInput,
  type PricingRequest,
  type PricingResponse,
} from "./pricing-job";
import { usePricing } from "./use-pricing";

class WorkerFixture {
  static instances: WorkerFixture[] = [];
  onmessage: ((event: MessageEvent<PricingResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: PricingRequest[] = [];
  stopped = false;
  run = pricingJob();
  constructor() {
    WorkerFixture.instances.push(this);
  }
  postMessage(request: PricingRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.stopped = true;
  }
  answer(index: number) {
    this.onmessage!({ data: this.run(this.requests[index]!) } as MessageEvent<PricingResponse>);
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  WorkerFixture.instances = [];
});

test("a Work edit immediately invalidates the observation; only the latest answer restores it", () => {
  vi.stubGlobal("Worker", WorkerFixture);
  const first: PricingInput = {
    snapshot: SCENE_FIXTURE.snapshot,
    grids: {},
    catalogs: EMPTY_CATALOGS,
    doc: ductsRouteState.schema.parse({}),
    revision: 1,
    epoch: 0,
    documentKey: "s/d",
  };
  const { result, rerender, unmount } = renderHook(
    (input: PricingInput | null) => usePricing(input),
    { initialProps: first as PricingInput | null },
  );
  const worker = WorkerFixture.instances[0]!;
  expect(result.current.observation).toBeNull();
  act(() => worker.answer(0));
  expect(result.current.observation?.input.revision).toBe(1);
  rerender({ ...first, revision: 2 });
  expect(result.current.observation).toBeNull();
  rerender({ ...first, revision: 3 });
  act(() => worker.answer(1));
  expect(result.current.observation).toBeNull();
  act(() => worker.answer(2));
  expect(result.current.observation?.input.revision).toBe(3);
  rerender(null);
  expect(result.current.observation).toBeNull();
  unmount();
  expect(worker.stopped).toBe(true);
});

test("unavailable Worker is an explicit failure with no synchronous solve fallback", () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw Error("Worker unavailable");
      }
    },
  );
  const input: PricingInput = {
    snapshot: SCENE_FIXTURE.snapshot,
    grids: {},
    catalogs: EMPTY_CATALOGS,
    doc: null,
    revision: 0,
    epoch: 0,
    documentKey: "s/d",
  };
  const { result } = renderHook(() => usePricing(input));
  expect(result.current.observation).toBeNull();
  expect(result.current.error).toContain("Worker unavailable");
});
