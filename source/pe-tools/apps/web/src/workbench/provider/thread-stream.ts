import { previousOf } from "#/readings";
import type { Reading } from "@pe/agent-contracts";
import type { AgentControllerEvent, MastraClient, MastraDBMessage } from "@mastra/client-js";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { Cause, Effect } from "effect";
import { useEffect, useMemo, useState } from "react";
import { emptyChatState, isUserTurn, type ChatDisplay, type ChatState } from "../chat-state";

type ControllerClient = ReturnType<MastraClient["getAgentController"]>;
type SessionClient = ReturnType<ControllerClient["session"]>;

const EMPTY = emptyChatState();
const emptyBodyAtom = Atom.make(AsyncResult.success(EMPTY));
type LiveThread = {
  key: string | null;
  frame: ChatDisplay | null;
  sent: MastraDBMessage[];
  fault: Error | null;
};

const emptyLive = () => ({ frame: null, sent: [] as MastraDBMessage[], fault: null });

const bodyAtoms = Atom.family((key: string) => {
  const [origin, threadId] = JSON.parse(key) as [string, string];
  return Atom.make(
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(`${origin}/pe/thread/${encodeURIComponent(threadId)}`, {
          signal,
        });
        if (!response.ok) throw new Error(`Thread sync failed (${response.status}).`);
        return response.json() as Promise<ChatState>;
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  ).pipe(Atom.autoDispose);
});

export const threadBodyAtom = (origin: string, threadId: string) =>
  bodyAtoms(JSON.stringify([origin, threadId]));

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
  const key = threadId === null ? null : JSON.stringify([origin, threadId]);
  const bodyAtom = useMemo(
    () => (threadId === null ? emptyBodyAtom : threadBodyAtom(origin, threadId)),
    [origin, threadId],
  );
  const body = useAtomValue(bodyAtom);
  // Live state is one current-thread slot, never a retained thread map. Reset during the
  // selection render so B cannot briefly project A while React waits to run an effect.
  const [live, setLive] = useState<LiveThread>(() => ({ key, ...emptyLive() }));
  if (live.key !== key) setLive({ key, ...emptyLive() });
  const current = live.key === key ? live : emptyLive();

  // The one refetch path: cancel kills a fetch that left before the change, so an older body
  // can never land after a newer one. It closes over `refresh` ALONE — `query` is a fresh object
  // every render, and an `invalidate` that changed identity per render tore the SSE subscription
  // down and reopened it on every render, dropping whatever `message_end` fired in the gap.
  const invalidate = useAtomRefresh(bodyAtom);
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    const accept = (event: AgentControllerEvent) => {
      if (stopped) return;
      const started = event.type === "message_start" ? (event.message as MastraDBMessage) : null;
      if (started && isUserTurn(started)) {
        setLive((previous) =>
          previous.key !== key || previous.sent.some((item) => item.id === started.id)
            ? previous
            : { ...previous, sent: [...previous.sent, started] },
        );
      }
      if (event.type === "display_state_changed") {
        const frame = event.displayState as ChatDisplay;
        setLive((previous) =>
          previous.key !== key
            ? previous
            : { ...previous, frame, fault: frame.isRunning ? null : previous.fault },
        );
      }
      if (event.type === "error" || (event.type === "agent_end" && event.reason === "error")) {
        setLive((previous) =>
          previous.key !== key
            ? previous
            : {
                ...previous,
                fault:
                  event.type === "error"
                    ? event.error instanceof Error
                      ? event.error
                      : new Error(String(event.error))
                    : (previous.fault ?? new Error("Run failed.")),
              },
        );
      }
      if (invalidatingEvents.has(event.type)) invalidate();
    };

    let unsubscribe: (() => void) | undefined;
    void session
      .subscribe({
        onEvent: accept,
        reconnect: true,
        onReconnect: () => invalidate(),
        onError: (error) => {
          if (!stopped)
            setLive((previous) =>
              previous.key === key
                ? { ...previous, fault: error instanceof Error ? error : new Error(String(error)) }
                : previous,
            );
        },
      })
      .then((subscription) => {
        if (stopped) subscription.unsubscribe();
        else unsubscribe = subscription.unsubscribe;
      })
      .catch((error) => {
        if (!stopped)
          setLive((previous) =>
            previous.key === key
              ? { ...previous, fault: error instanceof Error ? error : new Error(String(error)) }
              : previous,
          );
      });

    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [invalidate, key, session]);

  const chat = useMemo<ChatState>(() => {
    const stored = body._tag === "Success" ? body.value : EMPTY;
    if (current.sent.length === 0 && current.frame === null) return stored;
    const known = new Set(stored.messages.map((message) => message.id));
    const unstored = current.sent.filter((message) => !known.has(message.id));
    const messages = unstored.length ? [...stored.messages, ...unstored] : stored.messages;
    return { ...stored, messages, display: current.frame ?? stored.display };
  }, [body, current]);
  const error = useMemo(() => {
    if (body._tag !== "Failure") return current.fault;
    const fault = Cause.squash(body.cause);
    return fault instanceof Error ? fault : new Error(Cause.pretty(body.cause));
  }, [body, current.fault]);

  return {
    chat,
    // Pending exactly while a named thread has no body and no failure. Not `query.isPending`:
    // that is false on the first render after the thread appears (the fetch starts in an
    // effect), and true again on every refetch over a thread already on screen.
    pending: threadId !== null && body._tag === "Initial" && body.waiting,
    error,
    displayKnown: body._tag === "Success" || current.frame !== null,
    invalidate,
    bodyAtom,
  };
}
