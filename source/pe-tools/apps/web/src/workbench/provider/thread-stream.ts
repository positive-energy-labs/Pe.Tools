import type { AgentControllerEvent, MastraClient } from "@mastra/client-js";
import { useQuery, type QueryClient } from "@tanstack/react-query";
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
  queryClient: QueryClient;
  thread: { id: string; session: SessionClient } | null;
}) {
  const { origin, queryClient, thread } = options;
  const threadId = thread?.id ?? null;
  const session = thread?.session;
  const queryKey = threadQueryKey(origin, threadId);
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<ChatState> => {
      const response = await fetch(`${origin}/pe/thread/${encodeURIComponent(threadId ?? "")}`);
      if (!response.ok) throw new Error(`Thread sync failed (${response.status}).`);
      return response.json() as Promise<ChatState>;
    },
    enabled: threadId !== null,
    staleTime: Infinity,
  });
  // The stream is the only source of display: the server opens every attach with a snapshot
  // frame, so no fetch ever competes with it and no clock is needed.
  const [frame, setFrame] = useState<ChatDisplay | null>(null);
  const [streamFault, setStreamFault] = useState<Error | null>(null);

  useEffect(() => {
    setFrame(null);
    setStreamFault(null);
  }, [threadId]);

  // The one refetch path: cancel kills a fetch that left before the change, so an older body
  // can never land after a newer one.
  const invalidate = useCallback(async () => {
    const key = threadQueryKey(origin, threadId);
    await queryClient.cancelQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, origin, threadId]);

  useEffect(() => {
    if (!session || !query.isSuccess) return;
    let stopped = false;
    const accept = (event: AgentControllerEvent) => {
      if (stopped) return;
      if (event.type === "display_state_changed") {
        setFrame(event.displayState as ChatDisplay);
        setStreamFault(null);
      }
      if (event.type === "error" || (event.type === "agent_end" && event.reason === "error")) {
        setStreamFault(
          event.type === "error"
            ? event.error instanceof Error
              ? event.error
              : new Error(String(event.error))
            : new Error("Run failed."),
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
  }, [invalidate, query.isSuccess, session, threadId]);

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
