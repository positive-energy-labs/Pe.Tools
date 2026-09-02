import { Effect, PubSub, Stream } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { randomUUID } from "node:crypto";

/**
 * Host-stamped order for anything a browser must replay without loss: `epoch` is minted once per
 * host boot, `seq` counts up inside it. The key `epoch:seq` is the only order a client compares;
 * a different epoch is a reset, never a gap. Ledger 2026-09-02 CHAT LEDGER SHAPE (agent).
 */
export type Stamp = { readonly epoch: string; readonly seq: number; readonly atMs: number };
export type Stamped<T> = T & Stamp;

export interface Ledger<T> {
  readonly name: string;
  readonly epoch: string;
  readonly events: PubSub.PubSub<Stamped<T>>;
  /** Stamp, retain in the ring, publish. Synchronous so plain vendor callbacks can call it. */
  emit(event: T): Stamped<T>;
  /**
   * Entries after `after` (`epoch:seq`). When `after` is missing, from another epoch, or already
   * evicted, the answer is a reset: the snapshot (emitted into the ring at its own seq, so every
   * later entry orders after it) or, without a snapshot, the whole ring.
   */
  replay(after?: string): Promise<{ reset: boolean; entries: readonly Stamped<T>[] }>;
}

const EPOCH = randomUUID().slice(0, 8);
const ledgers = new Map<string, Ledger<unknown>>();

export function makeLedger<T>(options: {
  name: string;
  capacity: number;
  snapshot?: () => Promise<T>;
}): Ledger<T> {
  const ring: Stamped<T>[] = [];
  let seq = 0;
  const events = Effect.runSync(PubSub.unbounded<Stamped<T>>());
  const emit = (event: T) => {
    const entry: Stamped<T> = { ...event, epoch: EPOCH, seq: ++seq, atMs: Date.now() };
    ring.push(entry);
    if (ring.length > options.capacity) ring.shift();
    Effect.runSync(PubSub.publish(events, entry));
    return entry;
  };
  const ledger: Ledger<T> = {
    name: options.name,
    epoch: EPOCH,
    events,
    emit,
    replay: async (after) => {
      const [epoch, seqText] = after?.split(":") ?? [];
      const afterSeq = Number(seqText);
      const oldest = ring[0]?.seq ?? seq + 1;
      if (epoch === EPOCH && Number.isFinite(afterSeq) && afterSeq >= oldest - 1) {
        return { reset: false, entries: ring.filter((entry) => entry.seq > afterSeq) };
      }
      if (!options.snapshot) return { reset: true, entries: [...ring] };
      return { reset: true, entries: [emit(await options.snapshot())] };
    },
  };
  ledgers.set(options.name, ledger as Ledger<unknown>);
  return ledger;
}

export function closeLedger(name: string) {
  ledgers.delete(name);
}

const missing = (name: string) =>
  Response.jsonUnsafe({ error: `no ledger '${name}'` }, { status: 404 });

/** `GET /ledger/:name?after=epoch:seq` replay, `GET /ledger/:name/events` live SSE of stamped entries. */
export const ledgerRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", "/ledger/:name", (req) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const name = decodeURIComponent(params.name ?? "");
        const ledger = ledgers.get(name);
        if (!ledger) return missing(name);
        const after = new URL(req.url, "http://localhost").searchParams.get("after");
        const body = yield* Effect.promise(() => ledger.replay(after || undefined));
        return Response.jsonUnsafe({ epoch: ledger.epoch, ...body });
      }),
    );
    yield* router.add("GET", "/ledger/:name/events", () =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params;
        const name = decodeURIComponent(params.name ?? "");
        const ledger = ledgers.get(name);
        if (!ledger) return missing(name);
        const encoder = new TextEncoder();
        // The opening comment frame flushes headers at once: EventSource fires `open` (and the
        // client replays) even when the ledger stays quiet. No heartbeat after that; EventSource
        // auto-reconnects and replays by `after`.
        const body = Stream.make(encoder.encode(": open\n\n")).pipe(
          Stream.concat(
            Stream.fromPubSub(ledger.events).pipe(
              Stream.map((entry) => encoder.encode(`data: ${JSON.stringify(entry)}\n\n`)),
            ),
          ),
        );
        return Response.stream(body, {
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache", connection: "keep-alive" },
        });
      }),
    );
  }),
);
