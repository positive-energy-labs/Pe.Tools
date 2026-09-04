import type { AgentControllerEvent, MastraClient } from "@mastra/client-js";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { emptyChatState, type ChatDisplay, type ChatState } from "../chat-state";

type ControllerClient = ReturnType<MastraClient["getAgentController"]>;
type SessionClient = ReturnType<ControllerClient["session"]>;
type DisplayFrame = { at: number; value: ChatDisplay };

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
  const [frame, setFrame] = useState<DisplayFrame | null>(null);
  const [streamFault, setStreamFault] = useState<Error | null>(null);

  useEffect(() => {
    setFrame(null);
    setStreamFault(null);
  }, [threadId]);

  useEffect(() => {
    if (!session || !query.isSuccess) return;
    let stopped = false;
    const invalidate = async () => {
      await queryClient.cancelQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey });
    };
    const accept = (event: AgentControllerEvent) => {
      if (stopped) return;
      if (event.type === "display_state_changed") {
        setFrame({ at: Date.now(), value: event.displayState as ChatDisplay });
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
  }, [origin, queryClient, query.isSuccess, session, threadId]);

  const chat = useMemo(() => {
    if (!query.data) return EMPTY;
    const display = frame && frame.at >= query.dataUpdatedAt ? frame.value : query.data.display;
    return { ...query.data, display };
  }, [query.data, frame]);

  return [chat, threadId !== null && query.isPending, query.error ?? streamFault] as const;
}
