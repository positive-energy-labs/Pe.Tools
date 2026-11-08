import { peReadings, type Liveness } from "#/host/resource-stream";
import type { HarnessEvent } from "@pe/agent-contracts";
import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { Cause, Effect } from "effect";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
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
  const registry = useContext(RegistryContext);
  const liveAtom = useMemo(
    () =>
      Atom.make({
        events: [] as HarnessEvent[],
        fault: null as Error | null,
        stale: false,
        epoch: 0,
      }),
    [key],
  );
  const setLive = useCallback(
    (update: (live: Atom.Type<typeof liveAtom>) => Atom.Type<typeof liveAtom>) =>
      registry.update(liveAtom, update),
    [registry, liveAtom],
  );
  const fault = useAtomValue(liveAtom, (live) => live.fault);
  const stale = useAtomValue(liveAtom, (live) => live.stale);
  const epoch = useAtomValue(liveAtom, (live) => live.epoch);

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
  }, [invalidate, readings, threadId, setLive]);

  const stored: ThreadBody | undefined = body._tag === "Success" ? body.value : undefined;
  // Only a body the host answered after the resync clears the mark.
  const settled = body._tag === "Success" && !body.waiting;
  useEffect(() => {
    if (settled) setLive((previous) => (previous.stale ? { ...previous, stale: false } : previous));
  }, [settled, stored, setLive]);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  // A re-read body carries a new cursor: the follow restarts from it, and seq skips the overlap.
  const cursor = stored?.cursor;
  useEffect(() => {
    if (threadId === null || cursor === undefined) return;
    return streamThread({
      origin,
      threadId,
      cursor,
      lastSeq: lastSeq(storedRef.current?.events ?? []),
      onReread: invalidate,
      onEvent: (event) => {
        setLive((previous) => ({ ...previous, events: [...previous.events, event], fault: null }));
        const configuration =
          event.kind === "update" && event.update.sessionUpdate === "config_option_update";
        if (bodyEvents.has(event.kind) || configuration) invalidate();
        if (listEvents.has(event.kind) || configuration) onListChange.current?.();
      },
      onFault: (fault) => setLive((previous) => ({ ...previous, fault })),
    });
    // `epoch` reopens the follow after a resync.
  }, [cursor, epoch, invalidate, key, origin, threadId, setLive]);

  const chatAtom = useMemo(
    () =>
      Atom.make((get): ChatState => {
        const body = get(bodyAtom);
        if (body._tag !== "Success") return EMPTY;
        const stored = body.value;
        const after = lastSeq(stored.events);
        const tail = get(liveAtom).events.filter((event) => event.seq > after);
        return tail.length ? { ...stored, events: [...stored.events, ...tail] } : stored;
      }),
    [bodyAtom, liveAtom],
  );
  const error = useMemo(() => {
    if (body._tag !== "Failure")
      return (
        fault ??
        (stale ? new Error("This thread is not current; re-reading it from the host.") : null)
      );
    const caught = Cause.squash(body.cause);
    return caught instanceof Error ? caught : new Error(Cause.pretty(body.cause));
  }, [body, fault, stale]);

  return {
    chatAtom,
    pending: threadId !== null && body._tag === "Initial" && body.waiting,
    error,
    stale,
    invalidate,
    bodyAtom,
  };
}
