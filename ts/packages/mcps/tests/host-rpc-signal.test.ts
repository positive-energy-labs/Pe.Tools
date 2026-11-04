import { afterEach, expect, test, vi } from "vite-plus/test";
import { Effect, Fiber } from "effect";
import { runHostRpcEffect } from "../src/shared/host-rpc-caller.ts";

afterEach(() => vi.unstubAllGlobals());
test.each([undefined, 60_000])("fiber interruption aborts the native fetch (timeout %s)", async (timeoutMs) => {
  const signals: (AbortSignal | null | undefined)[] = [];
  let entered = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signals.push(signal);
    entered();
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  // effect-edge: test-runner
  const fiber = Effect.runFork(runHostRpcEffect("revit.detail.space-scene", {}, {
    hostBaseUrl: "http://host", timeoutMs,
  }));
  try {
    await Promise.race([started, new Promise<void>((_, reject) => setTimeout(() => reject(Error("fetch did not start")), 1000))]);
    // effect-edge: test-runner
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  } finally {
    fiber.interruptUnsafe();
  }
});
