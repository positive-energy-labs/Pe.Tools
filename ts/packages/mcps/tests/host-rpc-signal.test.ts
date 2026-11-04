import { afterEach, expect, vi } from "vite-plus/test";
import { Effect, Fiber } from "effect";
import { runHostRpcEffect } from "../src/shared/host-rpc-caller.ts";
import { effectTest } from "../../../apps/host/tests/effect-test.ts";

afterEach(() => vi.unstubAllGlobals());
for (const timeoutMs of [undefined, 60_000]) effectTest(`fiber interruption aborts the native fetch (timeout ${timeoutMs})`, () => Effect.gen(function* () {
  const signals: (AbortSignal | null | undefined)[] = [];
  let entered = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signals.push(signal);
    entered();
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const fiber = yield* Effect.forkChild(runHostRpcEffect("revit.detail.space-scene", {}, {
    hostBaseUrl: "http://host", timeoutMs,
  }));
  try {
    yield* Effect.tryPromise(() => Promise.race([started, new Promise<void>((_, reject) => setTimeout(() => reject(Error("fetch did not start")), 1000))]));
    yield* Fiber.interrupt(fiber);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  } finally {
    fiber.interruptUnsafe();
  }
}));
