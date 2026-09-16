// @vitest-environment jsdom
import type { AgentControllerEvent, MastraDBMessage } from "@mastra/client-js";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, selectMessages } from "../chat-state";
import { useThreadStream } from "./thread-stream";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const userSignal = {
  id: "u1",
  role: "signal",
  createdAt: new Date("2026-09-16T12:00:00Z"),
  content: {
    format: 2,
    parts: [
      {
        type: "data-user-message",
        data: { id: "u1", type: "user", contents: "hello pea", createdAt: "2026-09-16T12:00:00Z" },
      },
    ],
    metadata: { signal: { id: "u1", type: "user" } },
  },
} as unknown as MastraDBMessage;

const assistant = {
  id: "a1",
  role: "assistant",
  createdAt: new Date("2026-09-16T12:00:01Z"),
  content: { format: 2, parts: [{ type: "text", text: "Hi" }] },
} as unknown as MastraDBMessage;

test("a sent message stays listed while the first assistant block streams", async () => {
  // The host has not persisted the user row yet: every fetch answers the empty thread.
  const fetches = vi.fn(async () => new Response(JSON.stringify(emptyChatState())));
  vi.stubGlobal("fetch", fetches);
  let emit: (event: AgentControllerEvent) => void = () => {};
  const session = {
    subscribe: async (options: { onEvent: (event: AgentControllerEvent) => void }) => {
      emit = options.onEvent;
      return { unsubscribe: () => {} };
    },
  };
  const { result } = renderHook(() =>
    useThreadStream({ origin: "http://host", thread: { id: "t1", session: session as never } }),
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  await waitFor(() => expect(fetches).toHaveBeenCalledTimes(1));

  const frame = (currentMessage: MastraDBMessage) =>
    ({
      type: "display_state_changed",
      displayState: { isRunning: true, currentMessage },
    }) as unknown as AgentControllerEvent;
  act(() => {
    emit({ type: "message_start", message: userSignal } as AgentControllerEvent);
    emit(frame(userSignal));
    emit({ type: "message_end", message: userSignal } as AgentControllerEvent);
  });
  await waitFor(() => expect(fetches).toHaveBeenCalledTimes(2));
  act(() => {
    emit({ type: "message_start", message: assistant } as AgentControllerEvent);
    emit(frame(assistant));
  });

  const listed = selectMessages(result.current.chat).map((message) => message.id);
  expect(listed).toEqual(["u1", "a1"]);
});
