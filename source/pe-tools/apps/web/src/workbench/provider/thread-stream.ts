import { previousOf, useHostCall } from "#/readings";
import type { Reading } from "@pe/agent-contracts";
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

/**
 * Whether the chat is still waiting for its thread body. Decided by what has arrived, not by
 * request states: the host status Reading starts `absent` (never `loading`) until its first frame,
 * and until it lands there is no session, so no thread fetch either. A failed host status ends the
 * wait. Read as "loaded and empty" too early, the lens dropped a `?turn` it could not yet find.
 */
export function chatLoading(hostStatus: Reading<unknown>, threadPending: boolean): boolean {
  const hostKnown = previousOf(hostStatus) !== undefined || hostStatus.state === "failed";
  return !hostKnown || threadPending;
}

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
    // Pending exactly while a named thread has no body and no failure. Not `query.isPending`:
    // that is false on the first render after the thread appears (the fetch starts in an
    // effect), and true again on every refetch over a thread already on screen.
    pending: threadId !== null && !hydrated && query.error === undefined,
    error: query.error ?? streamFault,
    invalidate,
  };
}
