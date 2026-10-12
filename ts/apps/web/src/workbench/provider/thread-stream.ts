import { previousOf } from "#/readings";
import type { HarnessEvent, Reading } from "@pe/agent-contracts";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { Cause, Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { emptyChatState, type ChatState, type ThreadBody } from "../chat-state";
import { harnessClient, streamThread } from "./harness-client";

const EMPTY = emptyChatState();
const emptyBodyAtom = Atom.make(AsyncResult.success(EMPTY));

const bodyAtoms = Atom.family((key: string) => {
  const [origin, threadId] = JSON.parse(key) as [string, string];
  return Atom.make(
    Effect.tryPromise({
      try: (signal) => harnessClient(origin).body(threadId, signal),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  ).pipe(Atom.autoDispose);
});

/** Events that change the body's own fields (model, traits, session): re-read it. The queue and
 * the title fold from the log (`selectQueued`, `selectTitle`). */
const bodyEvents = new Set<HarnessEvent["kind"]>([
  "turn_end",
  "error",
  "model_changed",
  "trait_changed",
  "session",
]);

/** Events that change what the thread list says (title, `provider · model` line). */
const listEvents = new Set<HarnessEvent["kind"]>(["model_changed", "title_changed", "session"]);

const lastSeq = (events: readonly HarnessEvent[]) => events.at(-1)?.seq ?? 0;

/**
 * Whether the chat is still waiting for its thread body. A failed host status ends the wait; until
 * the host status Reading lands there is no thread fetch either.
 */
export function chatLoading(hostStatus: Reading<unknown>, threadPending: boolean): boolean {
  const hostKnown = previousOf(hostStatus) !== undefined || hostStatus.state === "failed";
  return !hostKnown || threadPending;
}

/**
 * One thread: its body on mount, then the SSE tail from the body's last seq. Live events append
 * to one current-thread slot; the body re-reads on events that change its own fields, and the
 * two merge by seq so neither replays the other.
 */
export function useThreadStream(options: {
  origin: string;
  threadId: string | null;
  /** The thread list is stale: an event changed what a summary says. */
  onListChange?: () => void;
}) {
  const { origin, threadId } = options;
  const onListChange = useRef(options.onListChange);
  onListChange.current = options.onListChange;
  const key = threadId === null ? null : JSON.stringify([origin, threadId]);
  const bodyAtom = useMemo(() => (key === null ? emptyBodyAtom : bodyAtoms(key)), [key]);
  const body = useAtomValue(bodyAtom);
  const invalidate = useAtomRefresh(bodyAtom);
  // Reset during the selection render so B never briefly projects A.
  const [live, setLive] = useState<{
    key: string | null;
    events: HarnessEvent[];
    fault: Error | null;
  }>(() => ({ key, events: [], fault: null }));
  if (live.key !== key) setLive({ key, events: [], fault: null });

  const stored: ThreadBody | undefined = body._tag === "Success" ? body.value : undefined;
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const loaded = stored !== undefined;
  useEffect(() => {
    if (threadId === null || !loaded) return;
    return streamThread({
      origin,
      threadId,
      after: lastSeq(storedRef.current?.events ?? []),
      onEvent: (event) => {
        setLive((previous) =>
          previous.key === key
            ? { ...previous, events: [...previous.events, event], fault: null }
            : previous,
        );
        if (bodyEvents.has(event.kind)) invalidate();
        if (listEvents.has(event.kind)) onListChange.current?.();
      },
      onFault: (fault) =>
        setLive((previous) => (previous.key === key ? { ...previous, fault } : previous)),
    });
  }, [invalidate, key, loaded, origin, threadId]);

  const chat = useMemo<ChatState>(() => {
    if (!stored) return EMPTY;
    const after = lastSeq(stored.events);
    const tail = live.key === key ? live.events.filter((event) => event.seq > after) : [];
    return tail.length ? { ...stored, events: [...stored.events, ...tail] } : stored;
  }, [key, live, stored]);
  const error = useMemo(() => {
    if (body._tag !== "Failure") return live.key === key ? live.fault : null;
    const fault = Cause.squash(body.cause);
    return fault instanceof Error ? fault : new Error(Cause.pretty(body.cause));
  }, [body, key, live]);

  return {
    chat,
    pending: threadId !== null && body._tag === "Initial" && body.waiting,
    error,
    invalidate,
    bodyAtom,
  };
}
