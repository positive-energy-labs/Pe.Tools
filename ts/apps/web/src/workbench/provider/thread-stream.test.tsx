// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { HarnessEvent } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { useThreadStream } from "./thread-stream";

const wire = vi.hoisted(() => ({ body: vi.fn(), stream: vi.fn() }));
vi.mock("./harness-client", () => ({
  harnessClient: () => ({ body: wire.body }),
  streamThread: wire.stream,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("an unsolicited configuration event refreshes the chips and thread summary before turn end", async () => {
  const state = { ...emptyChatState(), id: "config-live", modelId: "m1", running: true };
  wire.body.mockResolvedValue(state);
  let receive!: (event: HarnessEvent) => void;
  wire.stream.mockImplementation(({ onEvent }) => {
    receive = onEvent;
    return () => {};
  });
  const summary = vi.fn();
  const { result } = renderHook(() =>
    useThreadStream({ origin: "", threadId: state.id, onListChange: summary }),
  );
  await waitFor(() => expect(result.current.chat.modelId).toBe("m1"));
  await waitFor(() => expect(receive).toBeTypeOf("function"));
  wire.body.mockResolvedValue({
    ...state,
    modelId: "m2",
    traits: [{ id: "fast", name: "Fast", kind: "boolean", current: true }],
  });
  act(() =>
    receive({
      seq: 1,
      at: "2026-10-11",
      kind: "update",
      turnId: "turn",
      update: { sessionUpdate: "config_option_update", configOptions: [] },
    }),
  );
  await waitFor(() => expect(result.current.chat.modelId).toBe("m2"));
  expect(result.current.chat.traits[0]?.current).toBe(true);
  expect(result.current.chat.running).toBe(true);
  expect(summary).toHaveBeenCalledOnce();
});
