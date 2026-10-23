import { expect, test, vi } from "vite-plus/test";
import { readingFrameSchema, readingKey, type ReadingFrame } from "@pe/agent-contracts";
import { resourceResponse } from "@pe/runtime";
import type { HostBridgeEvent, RevitBridge } from "../src/bridge.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";

const world = { kind: "world" } as const;
const key = readingKey(world);

test.each([false, true])("a quiet world acquires with bridge=%s", (connected) => {
  const releaseBridge = vi.fn();
  const subscribe = vi.fn(() => releaseBridge);
  const bridge = connected ? ({ subscribe } as unknown as RevitBridge["Service"]) : undefined;
  const frames: ReadingFrame[] = [];
  const release = hostResourceObserver(bridge)(world, (frame) => frames.push(frame));
  try {
    expect(frames.map((frame) => readingFrameSchema.parse(frame))).toEqual([
      { kind: "snapshot", key, value: null },
    ]);
    expect(subscribe).toHaveBeenCalledTimes(connected ? 1 : 0);
  } finally {
    release();
  }
  expect(releaseBridge).toHaveBeenCalledTimes(connected ? 1 : 0);
});

test("world stream keeps its initial gap and forwards events after acquisition", async () => {
  let emit!: (event: HostBridgeEvent) => void;
  const releaseBridge = vi.fn();
  const bridge = {
    subscribe: (listener: typeof emit) => {
      emit = listener;
      return releaseBridge;
    },
  } as unknown as RevitBridge["Service"];
  const url = new URL("http://host/pe/resources");
  url.searchParams.set("keys", JSON.stringify([world]));
  const reader = resourceResponse(new Request(url), hostResourceObserver(bridge)).body!.getReader();
  const next = async () => {
    const text = new TextDecoder().decode((await reader.read()).value);
    return readingFrameSchema.parse(JSON.parse(text.slice("data: ".length).trim()));
  };
  try {
    expect(await next()).toEqual({ kind: "gap", key, dropped: null });
    const event: HostBridgeEvent = { kind: "connected", sessionId: "s1" };
    emit(event);
    expect(await next()).toEqual({ kind: "snapshot", key, value: null });
    expect(await next()).toEqual({
      kind: "event",
      key,
      value: { ...event, atMs: expect.any(Number) },
    });
  } finally {
    await reader.cancel();
  }
  expect(releaseBridge).toHaveBeenCalledOnce();
});
