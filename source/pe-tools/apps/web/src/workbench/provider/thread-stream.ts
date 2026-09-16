import { useHostCall } from "#/readings";
import type { AgentControllerEvent, MastraClient, MastraDBMessage } from "@mastra/client-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyChatState, isUserTurn, type ChatDisplay, type ChatState } from "../chat-state";

type ControllerClient = ReturnType<MastraClient["getAgentController"]>;
type SessionClient = ReturnType<ControllerClient["session"]>;

const EMPTY = emptyChatState();

const invalidatingEvents = new Set<AgentControllerEvent["type"]>([
  "message_end",
  "agent_end",
  "thread_deleted",
  "model_changed",
  "mode_changed",
]);

export const threadQueryKey = (origin: string, threadId: string | null) =>
  ["pe-thread", origin, threadId] as const;

export function useThreadStream(options: {
  origin: string;
  thread: { id: string; session: SessionClient } | null;
}) {
  const { origin, thread } = options;
  const threadId = thread?.id ?? null;
  const session = thread?.session;
  const query = useHostCall(
    async (): Promise<ChatState> => {
      const response = await fetch(`${origin}/pe/thread/${encodeURIComponent(threadId ?? "")}`);
      if (!response.ok) throw new Error(`Thread sync failed (${response.status}).`);
      return response.json() as Promise<ChatState>;
    },
    [origin, threadId],
    threadId !== null,
  );
  // The stream is the only source of display: the server opens every attach with a snapshot
  // frame, so no fetch ever competes with it and no clock is needed.
  const [frame, setFrame] = useState<ChatDisplay | null>(null);
  const [streamFault, setStreamFault] = useState<Error | null>(null);
  // A user turn the stream announced but the fetched body does not hold yet. The display frame
  // carries it only until the assistant's first delta replaces `currentMessage`, and the host
  // persists the row later than the `message_end` refetch, so without this the sent message
  // vanished until the assistant block ended. The wire id is the persisted row id.
  const [sent, setSent] = useState<MastraDBMessage[]>([]);

  useEffect(() => {
    setFrame(null);
    setStreamFault(null);
    setSent([]);
  }, [threadId]);

  // The one refetch path: cancel kills a fetch that left before the change, so an older body
  // can never land after a newer one. It closes over `refresh` ALONE — `query` is a fresh object
  // every render, and an `invalidate` that changed identity per render tore the SSE subscription
  // down and reopened it on every render, dropping whatever `message_end` fired in the gap.
  const refresh = query.refresh;
  const invalidate = useCallback(async () => {
    refresh();
  }, [refresh]);
  const hydrated = query.data !== undefined;

  useEffect(() => {
    if (!session || !hydrated) return;
    let stopped = false;
    const accept = (event: AgentControllerEvent) => {
      if (stopped) return;
      const started = event.type === "message_start" ? (event.message as MastraDBMessage) : null;
      if (started && isUserTurn(started)) {
        setSent((previous) =>
          previous.some((item) => item.id === started.id) ? previous : [...previous, started],
        );
      }
      if (event.type === "display_state_changed") {
        setFrame(event.displayState as ChatDisplay);
        if ((event.displayState as ChatDisplay).isRunning) setStreamFault(null);
      }
      if (event.type === "error" || (event.type === "agent_end" && event.reason === "error")) {
        setStreamFault((previous) =>
          event.type === "error"
            ? event.error instanceof Error
              ? event.error
              : new Error(String(event.error))
            : (previous ?? new Error("Run failed.")),
        );
      }
      if (invalidatingEvents.has(event.type)) void invalidate();
    };

    let unsubscribe: (() => void) | undefined;
    void session
      .subscribe({
        onEvent: accept,
        reconnect: true,
        onReconnect: () => void invalidate(),
        onError: (error) => {
          if (!stopped) setStreamFault(error instanceof Error ? error : new Error(String(error)));
        },
      })
      .then((subscription) => {
        if (stopped) subscription.unsubscribe();
        else unsubscribe = subscription.unsubscribe;
      })
      .catch((error) => {
        if (!stopped) setStreamFault(error instanceof Error ? error : new Error(String(error)));
      });

    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [invalidate, hydrated, session, threadId]);

  const chat = useMemo<ChatState>(() => {
    if (!query.data) return EMPTY;
    const stored = new Set(query.data.messages.map((message) => message.id));
    const unstored = sent.filter((message) => !stored.has(message.id));
    const messages = unstored.length ? [...query.data.messages, ...unstored] : query.data.messages;
    return { ...query.data, messages, display: frame ?? {} };
  }, [query.data, frame, sent]);

  return {
    chat,
    // Pending ONLY while there is nothing to show. `useHostCall` raises `pending` on every
    // refetch — and message_end, agent_end and each SSE reconnect refetch — so reporting raw
    // pending flashed "Loading thread state" after every completed turn over a thread that was
    // already on screen.
    pending: threadId !== null && query.isPending && !hydrated,
    error: query.error ?? streamFault,
    invalidate,
  };
}
