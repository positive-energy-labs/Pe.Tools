import { useHostCall } from "#/readings";
import type { AgentControllerEvent, MastraClient } from "@mastra/client-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyChatState, type ChatDisplay, type ChatState } from "../chat-state";

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

  useEffect(() => {
    setFrame(null);
    setStreamFault(null);
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

  const chat = useMemo<ChatState>(
    () => (query.data ? { ...query.data, display: frame ?? {} } : EMPTY),
    [query.data, frame],
  );

  return {
    chat,
    pending: threadId !== null && query.isPending,
    error: query.error ?? streamFault,
    invalidate,
  };
}
