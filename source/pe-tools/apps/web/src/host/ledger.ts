import { useEffect, useReducer, useRef } from "react";

/** Host stamp on every ledger entry (`apps/host/src/ledger.ts`). The key `epoch:seq` is the only order compared. */
export type Stamp = { epoch: string; seq: number; atMs: number };
export type Stamped<T> = T & Stamp;

type Action<T, S> = { entry: T } | { reset: S };

/**
 * One host ledger reduced by one reducer. Subscribe first, replay from the last key, then stay
 * live: an entry seen twice is dropped by key, a reset (first load, evicted, new host epoch)
 * re-initializes state and reduces what the host answers (its snapshot, or the whole ring).
 * Local events reduce through the same function and never advance the key.
 */
export function useLedger<T, S>(
  name: string | null,
  reduce: (state: S, event: T) => S,
  initial: () => S,
  hooks?: {
    onEntry?: (entry: Stamped<T>) => void;
    /** The host refused the stream (no such ledger, e.g. after a host restart); the owner re-creates it. */
    onClosed?: () => void;
  },
): readonly [state: S, dispatch: (event: T) => void, ready: boolean] {
  const refs = useRef({ reduce, initial, hooks });
  refs.current = { reduce, initial, hooks };
  const [state, dispatch] = useReducer(
    (current: S, action: Action<T, S>): S =>
      "reset" in action ? action.reset : refs.current.reduce(current, action.entry),
    undefined,
    initial,
  );
  const [ready, setReady] = useReducer((_: boolean, next: boolean) => next, false);

  useEffect(() => {
    dispatch({ reset: refs.current.initial() });
    setReady(false);
    if (!name) return;
    let key: string | null = null;
    let live = false;
    const buffer: Stamped<T>[] = [];
    const accept = (entry: Stamped<T>) => {
      const [epoch, seq] = key?.split(":") ?? [];
      if (epoch === entry.epoch && entry.seq <= Number(seq)) return; // replayed and delivered
      key = `${entry.epoch}:${entry.seq}`;
      dispatch({ entry });
      refs.current.hooks?.onEntry?.(entry);
    };
    const path = `/ledger/${encodeURIComponent(name)}`;
    const source = new EventSource(`${path}/events`);
    source.onmessage = (message) => {
      const entry = JSON.parse(message.data as string) as Stamped<T>;
      if (live) accept(entry);
      else buffer.push(entry);
    };
    // A non-2xx answer closes the source for good (no retry): the ledger is gone, not busy.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) refs.current.hooks?.onClosed?.();
    };
    // Every open, including EventSource's own reconnect, replays from the last key.
    source.onopen = () => {
      live = false;
      void fetch(key ? `${path}?after=${encodeURIComponent(key)}` : path)
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ reset: boolean; entries: Stamped<T>[] }>)
            : Promise.reject(new Error(`${path} ${response.status}`)),
        )
        .then((body) => {
          if (body.reset) {
            key = null;
            dispatch({ reset: refs.current.initial() });
          }
          for (const entry of body.entries) accept(entry);
        })
        .catch(() => undefined)
        .finally(() => {
          for (const entry of buffer.splice(0)) accept(entry);
          live = true;
          setReady(true);
        });
    };
    return () => source.close();
  }, [name]);

  return [state, (event: T) => dispatch({ entry: event }), ready] as const;
}
