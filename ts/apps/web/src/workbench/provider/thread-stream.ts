import { peReadings, type Liveness } from "#/readings";
import type { HarnessEvent } from "@pe/agent-contracts";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { Cause, Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { emptyChatState, type ChatState, type ThreadBody } from "@pe/agent-contracts/chat-state";
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

/** Events that change the body's own fields (model, traits, session): re-read it. The title
 * folds from the log (`selectTitle`). */
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
export function chatLoading(hostKnown: boolean, threadPending: boolean): boolean {
  return !hostKnown || threadPending;
}

/**
 * One thread: its body on mount, then its `thread` Reading from the body's host log cursor. Live events append
 * to one current-thread slot; the body re-reads on events that change its own fields, and the
 * two merge by seq so neither replays the other.
 */
export function useThreadStream(options: {
  origin: string;
  threadId: string | null;
  /** The thread list is stale: an event changed what a summary says. */
  onListChange?: () => void;
  /** Whose liveness this follow obeys: the one Readings owner. */
  readings?: Liveness;
}) {
  const { origin, threadId, readings = peReadings } = options;
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
    /** The owner resynced; this view is not current until the re-read body lands. */
    stale: boolean;
    /** Bumped per resync: the follow reopens from its cursor even when the body did not move. */
    epoch: number;
  }>(() => ({ key, events: [], fault: null, stale: false, epoch: 0 }));
  if (live.key !== key) setLive({ key, events: [], fault: null, stale: false, epoch: 0 });

  // The readings connection faulted or the tab woke: this tail may be a dead socket that never
  // errors. Mark the view stale, re-read the body (a new cursor), and reopen the follow.
  useEffect(() => {
    // Null is the caller's explicit browser-draft identity, not an empty host transcript.
    // It has no body to re-read; durable threads, including empty ones, still resync below.
    if (threadId === null) return;
    return readings.onResync(() => {
      setLive((previous) => ({ ...previous, stale: true, epoch: previous.epoch + 1 }));
      invalidate();
    });
  }, [invalidate, readings, threadId]);

  const stored: ThreadBody | undefined = body._tag === "Success" ? body.value : undefined;
  // Only a body the host answered after the resync clears the mark.
  const settled = body._tag === "Success" && !body.waiting;
  useEffect(() => {
    if (settled) setLive((previous) => (previous.stale ? { ...previous, stale: false } : previous));
  }, [settled, stored]);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  // A re-read body carries a new cursor: the follow restarts from it, and seq skips the overlap.
  const cursor = stored?.cursor;
  const epoch = live.epoch;
  useEffect(() => {
    if (threadId === null || cursor === undefined) return;
    return streamThread({
      origin,
      threadId,
      cursor,
      lastSeq: lastSeq(storedRef.current?.events ?? []),
      onReread: invalidate,
      onEvent: (event) => {
        setLive((previous) =>
          previous.key === key
            ? { ...previous, events: [...previous.events, event], fault: null }
            : previous,
        );
        const configuration =
          event.kind === "update" && event.update.sessionUpdate === "config_option_update";
        if (bodyEvents.has(event.kind) || configuration) invalidate();
        if (listEvents.has(event.kind) || configuration) onListChange.current?.();
      },
      onFault: (fault) =>
        setLive((previous) => (previous.key === key ? { ...previous, fault } : previous)),
    });
    // `epoch` reopens the follow after a resync.
  }, [cursor, epoch, invalidate, key, origin, threadId]);

  const chat = useMemo<ChatState>(() => {
    if (!stored) return EMPTY;
    const after = lastSeq(stored.events);
    const tail = live.key === key ? live.events.filter((event) => event.seq > after) : [];
    return tail.length ? { ...stored, events: [...stored.events, ...tail] } : stored;
  }, [key, live, stored]);
  const error = useMemo(() => {
    if (body._tag !== "Failure")
      return live.key !== key
        ? null
        : (live.fault ??
            (live.stale
              ? new Error("This thread is not current; re-reading it from the host.")
              : null));
    const fault = Cause.squash(body.cause);
    return fault instanceof Error ? fault : new Error(Cause.pretty(body.cause));
  }, [body, key, live]);

  return {
    chat,
    pending: threadId !== null && body._tag === "Initial" && body.waiting,
    error,
    stale: live.key === key && live.stale,
    invalidate,
    bodyAtom,
  };
}
