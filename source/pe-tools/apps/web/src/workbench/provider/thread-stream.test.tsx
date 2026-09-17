// @vitest-environment jsdom
import type { AgentControllerEvent, MastraDBMessage } from "@mastra/client-js";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, selectApprovals, selectMessages, type ChatState } from "../chat-state";
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

const threadBody = (state: ChatState = emptyChatState()) => {
  const { display: _display, ...body } = state;
  return body;
};

test("a sent message stays listed while the first assistant block streams", async () => {
  // The host has not persisted the user row yet: every fetch answers the empty thread.
  const fetches = vi.fn(async () => new Response(JSON.stringify(threadBody())));
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

test("the thread reports pending on every render until its body is here", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(threadBody()))),
  );
  const session = { subscribe: async () => ({ unsubscribe: () => {} }) };
  let noBody: unknown;
  const renders: { pending: boolean; body: boolean }[] = [];
  const { rerender } = renderHook(
    ({ thread }: { thread: { id: string; session: never } | null }) => {
      const stream = useThreadStream({ origin: "http://host", thread });
      noBody ??= stream.chat; // the shared empty state, before any body exists
      if (thread) renders.push({ pending: stream.pending, body: stream.chat !== noBody });
      return stream;
    },
    { initialProps: { thread: null } as { thread: { id: string; session: never } | null } },
  );
  // The session appears (host status landed): from this render on, a thread is named whose body
  // has not arrived, and the lens must not read that as "loaded, and empty".
  rerender({ thread: { id: "t1", session: session as never } });
  await waitFor(() => expect(renders.at(-1)?.body).toBe(true));
  expect(renders.filter((render) => !render.body && !render.pending)).toEqual([]);
});

test("an unchanged ready body keeps its snapshot identity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(threadBody()))),
  );
  const session = { subscribe: async () => ({ unsubscribe: () => {} }) };
  const { result, rerender } = renderHook(() =>
    useThreadStream({
      origin: "http://host",
      thread: { id: "identity-thread", session: session as never },
    }),
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  const ready = result.current.chat;
  rerender();
  expect(result.current.chat).toBe(ready);
});

test("a failed body recovers on retry and reconnect without changing thread", async () => {
  let attempts = 0;
  const fetches = vi.fn(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return new Response(JSON.stringify(threadBody()));
  });
  vi.stubGlobal("fetch", fetches);
  let reconnect: () => void = () => {};
  const session = {
    subscribe: async (options: { onReconnect: () => void }) => {
      reconnect = options.onReconnect;
      return { unsubscribe: () => {} };
    },
  };
  const { result } = renderHook(() =>
    useThreadStream({
      origin: "http://host",
      thread: { id: "recovery-thread", session: session as never },
    }),
  );
  await waitFor(() => expect(result.current.error?.message).toBe("offline"));
  act(() => result.current.invalidate());
  await waitFor(() => expect(result.current.error).toBeNull());
  act(reconnect);
  await waitFor(() => expect(fetches).toHaveBeenCalledTimes(3));
});

test("switching threads aborts A and never publishes A under B", async () => {
  let settleA!: (response: Response) => void;
  let signalA: AbortSignal | undefined;
  const bodyB = threadBody({ ...emptyChatState(), messages: [assistant] });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/thread-a")) {
        signalA = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          settleA = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify(bodyB)));
    }),
  );
  const session = { subscribe: async () => ({ unsubscribe: () => {} }) };
  const { result, rerender } = renderHook(
    ({ id }) =>
      useThreadStream({ origin: "http://host", thread: { id, session: session as never } }),
    { initialProps: { id: "thread-a" } },
  );
  await waitFor(() => expect(signalA).toBeDefined());
  rerender({ id: "thread-b" });
  await waitFor(() =>
    expect(selectMessages(result.current.chat).map((message) => message.id)).toEqual(["a1"]),
  );
  await waitFor(() => expect(signalA?.aborted).toBe(true));
  await act(async () =>
    settleA(
      new Response(JSON.stringify(threadBody({ ...emptyChatState(), messages: [userSignal] }))),
    ),
  );
  expect(selectMessages(result.current.chat).map((message) => message.id)).toEqual(["a1"]);
});

test("a live approval is available before its body, and A cannot leak into B", async () => {
  let settleA!: (response: Response) => void;
  let settleB!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          if (url.endsWith("/delayed-thread-a")) settleA = resolve;
          else settleB = resolve;
        }),
    ),
  );
  const listeners: ((event: AgentControllerEvent) => void)[] = [];
  const session = {
    subscribe: async (options: { onEvent: (event: AgentControllerEvent) => void }) => {
      listeners.push(options.onEvent);
      return { unsubscribe: () => {} };
    },
  };
  const approval = (id: string) =>
    ({
      type: "display_state_changed",
      displayState: {
        isRunning: true,
        pendingApproval: { toolCallId: id, toolName: "write" },
      },
    }) as unknown as AgentControllerEvent;
  const { result, rerender } = renderHook(
    ({ id }) =>
      useThreadStream({ origin: "http://host", thread: { id, session: session as never } }),
    { initialProps: { id: "delayed-thread-a" } },
  );
  await waitFor(() => expect(listeners).toHaveLength(1));
  act(() => listeners[0]!(approval("approve-a")));
  await waitFor(() =>
    expect(selectApprovals(result.current.chat.display)[0]?.toolCallId).toBe("approve-a"),
  );
  expect(result.current.displayKnown).toBe(true);

  rerender({ id: "delayed-thread-b" });
  await waitFor(() => expect(listeners).toHaveLength(2));
  expect(result.current.displayKnown).toBe(false);
  expect(selectApprovals(result.current.chat.display)).toEqual([]);
  act(() => listeners[1]!(approval("approve-b")));
  await waitFor(() =>
    expect(selectApprovals(result.current.chat.display)[0]?.toolCallId).toBe("approve-b"),
  );

  await act(async () =>
    settleA(
      new Response(JSON.stringify(threadBody({ ...emptyChatState(), messages: [userSignal] }))),
    ),
  );
  expect(selectMessages(result.current.chat).some((message) => message.id === "u1")).toBe(false);
  expect(selectApprovals(result.current.chat.display)[0]?.toolCallId).toBe("approve-b");
  await act(async () => settleB(new Response(JSON.stringify(threadBody()))));
});

test("a wire body does not make the display ready before its first stream frame", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(threadBody()))),
  );
  let emit: (event: AgentControllerEvent) => void = () => {};
  const session = {
    subscribe: async (options: { onEvent: (event: AgentControllerEvent) => void }) => {
      emit = options.onEvent;
      return { unsubscribe: () => {} };
    },
  };
  const { result } = renderHook(() =>
    useThreadStream({
      origin: "http://host",
      thread: { id: "wire-thread", session: session as never },
    }),
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.chat.display).toEqual({});
  expect(result.current.displayKnown).toBe(false);
  act(() =>
    emit({
      type: "display_state_changed",
      displayState: { isRunning: false },
    } as AgentControllerEvent),
  );
  await waitFor(() => expect(result.current.displayKnown).toBe(true));
});
