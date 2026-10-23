import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { hostFetch, runtimeStreamUrl } from "#/host/runtime";
/**
 * The read layer. One EventSource, one AtomRegistry, one vocabulary (fable law 5).
 *
 * A Reading is anything observed from Revit, the host, or disk. Every observation in the web app
 * arrives through `readingAtom` over `peReadings`. Large immutable Ducts bodies are retained by
 * the version this stream confirms; retained bytes never establish freshness. A write is not a
 * Reading: it is a plain async call whose success calls `dirty(request)`,
 * which reacquires that subject's snapshot from the host.
 *
 * This file absorbs host/resources.ts, host/resource-client.ts, host/queries.ts, host/live.ts,
 * host/fleet.ts, host/events.ts and the surviving half of host/target.ts.
 */
import {
  READING_MAX_FRAME_BYTES,
  READING_MAX_KEYS,
  readingFrameSchema,
  readingKey,
  readingRequestSchema,
  addressSchema,
  type Address,
  type Reading,
  type ReadingFrame,
  type ReadingRequest,
  type TargetInventory,
  DUCTS_BODY_VERSION_HEADER,
  DUCTS_REFRESH_HEADER,
  ductsReadingEnvelopeSchema,
  type DuctsReadingRequest,
  type DuctsReadingEnvelope,
} from "@pe/agent-contracts";
import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Custody, Lane } from "@pe/host-contracts/contracts";
import type {
  BridgeSessionListEntry,
  HostOpResponse,
  HostSessionScope,
  OpCallArgs,
  OpKey,
} from "@pe/host-contracts/operation-types";
import { callHostRpc } from "#/host/client.ts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
} from "@pe/host-contracts/operation-types";
import { reportFault } from "#/host/diagnostics";
import { HOST_READ_WAIT_S } from "#/route/waits";
import { resolveWorkbenchConfig } from "#/workbench/config.ts";
import { deepEqual } from "@tanstack/react-router";

export type { Lane };

/* -- The one wire ------------------------------------------------------------------------- */

type Frame = (ReadingFrame & { stale?: boolean }) | { kind: "stale"; key: string };
type Source = Pick<EventSource, "onopen" | "onmessage" | "onerror" | "close">;

/** How long a subscribed key may wait for its owner acquisition; past it the connection is dead. */
const READING_DEADLINE_MS = 30_000;
/** Reconnect delays double from 1 s to this ceiling, and reset on the first fresh frame. */
const RETRY_CEILING_MS = 30_000;
/** A tab hidden at least this long resyncs when it is shown again (a frozen tab's socket lies). */
const WAKE_AFTER_MS = 5_000;

/** The one place the web opens an SSE stream: Readings, and a harness thread's tail. */
export const openEventSource = (url: string) => new EventSource(runtimeStreamUrl(url));

/** One browser connection. This map owns subscriptions and retained evidence, never owner truth. */
export class PeReadings {
  private readonly entries = new Map<
    string,
    {
      request: ReadingRequest;
      listeners: Set<(frame: Frame) => void>;
      latest?: ReadingFrame;
      stale: boolean;
    }
  >();
  private source?: Source;
  /** The stream being replaced by a topology swap; closed once the replacement opens. */
  private retiring?: Source;
  private generation = 0;
  private scheduled = false;
  private pendingFenced = false;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  /** A stream opened since the last loss: its loss is one fault, its reconnect attempts are not. */
  private opened = false;
  /** Reconnects since the last fresh frame; the next delay is 1 s doubled this many times. */
  private attempts = 0;
  /** A connection whose keys are not all fresh by the deadline is faulted (it opened and went silent). */
  private watchdog?: ReturnType<typeof setTimeout>;
  /** A fault or wake happened; the next open tells every resync listener to re-read. */
  private faulted = false;
  private readonly resyncs = new Set<() => void>();
  private unwatchWake?: () => void;
  private readonly pending = new Map<string, Frame[]>();
  private cancelDelivery?: () => void;

  constructor(
    private readonly url: () => string,
    private readonly connect: (url: string) => Source = openEventSource,
    private readonly batch: (deliver: () => void) => () => void = (deliver) => {
      if (typeof requestAnimationFrame !== "function") {
        deliver();
        return () => {};
      }
      if (document.visibilityState === "hidden") {
        const timer = setTimeout(deliver, 0);
        return () => clearTimeout(timer);
      }
      const frame = requestAnimationFrame(deliver);
      return () => cancelAnimationFrame(frame);
    },
  ) {}

  /** Retire this owner's transport. Idempotent, and one-way: no further request is ever issued. */
  close() {
    this.closed = true;
    this.cancelDelivery?.();
    this.cancelDelivery = undefined;
    this.pending.clear();
    this.generation++;
    this.scheduled = false;
    this.pendingFenced = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    clearTimeout(this.watchdog);
    this.source?.close();
    this.source = undefined;
    this.retiring?.close();
    this.retiring = undefined;
    this.entries.clear();
    this.resyncs.clear();
    this.unwatchWake?.();
    this.unwatchWake = undefined;
  }

  /**
   * Transports this owner cannot carry (a thread's log tail, which resumes from its own cursor)
   * follow its liveness: the listener runs when the connection reopens after a fault or a wake,
   * and re-reads its own state from the host. One owner decides when the world is suspect.
   */
  onResync(listener: () => void): () => void {
    this.resyncs.add(listener);
    return () => void this.resyncs.delete(listener);
  }

  /**
   * The world may have moved without this tab hearing it (the tab woke, the network came back):
   * fence every key, reconnect now, and have every follower re-read. Coalesced per tick, so a
   * burst of wake signals is one reconnect.
   */
  resync() {
    if (this.closed) return;
    this.faulted = true;
    this.attempts = 0;
    if (this.entries.size === 0) return this.recovered();
    this.schedule(true);
  }

  private recovered() {
    if (!this.faulted) return;
    this.faulted = false;
    for (const listener of this.resyncs) listener();
  }

  /** The stream failed or went silent: one fault per outage, then reconnect with backoff. */
  private fault() {
    if (this.closed) return;
    if (this.opened) reportFault({ code: "stream.failed", streamKind: "readings" });
    this.opened = false;
    this.faulted = true;
    this.lose(true);
  }

  private watchWake() {
    if (this.unwatchWake || typeof document === "undefined") return;
    let hiddenAt: number | undefined;
    const visibility = () => {
      if (document.visibilityState === "hidden") hiddenAt ??= Date.now();
      else if (hiddenAt !== undefined) {
        const slept = Date.now() - hiddenAt;
        hiddenAt = undefined;
        if (slept >= WAKE_AFTER_MS) this.resync();
      }
    };
    const online = () => this.resync();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    this.unwatchWake = () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
    };
  }

  subscribe(raw: ReadingRequest, listener: (frame: Frame) => void): () => void {
    if (this.closed) throw Error("This Pe reading owner is retired");
    const request = readingRequestSchema.parse(raw);
    const key = readingKey(request);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= READING_MAX_KEYS) throw Error("Too many Pe reading subscriptions");
      entry = { request, listeners: new Set(), stale: true };
      this.entries.set(key, entry);
      this.schedule(false);
    }
    const found = entry;
    found.listeners.add(listener);
    if (found.latest) listener({ ...found.latest, stale: found.stale });
    if (found.stale) listener({ kind: "stale", key });
    return () => {
      found.listeners.delete(listener);
      if (found.listeners.size === 0 && this.entries.get(key) === found) {
        this.entries.delete(key);
        this.pending.delete(key);
        this.schedule(false);
      }
    };
  }

  /**
   * An Action succeeded, so this subject's retained observation is no longer evidence. Reconnect
   * reacquires every open subject's snapshot; a gap frame diagnoses loss, it never replaces one.
   */
  dirty(request: ReadingRequest) {
    if (this.entries.has(readingKey(request))) this.schedule();
  }

  private lose(retry: boolean) {
    this.cancelDelivery?.();
    this.cancelDelivery = undefined;
    this.pending.clear();
    this.generation++;
    clearTimeout(this.watchdog);
    this.source?.close();
    this.source = undefined;
    this.retiring?.close();
    this.retiring = undefined;
    for (const [key, entry] of this.entries) {
      entry.stale = true;
      for (const accept of entry.listeners) accept({ kind: "stale", key });
    }
    if (retry)
      this.retry = setTimeout(
        () => {
          this.retry = undefined;
          this.open();
        },
        Math.min(RETRY_CEILING_MS, 1000 * 2 ** this.attempts++),
      );
  }

  /**
   * A topology change (a key joined or left) swaps the stream without fencing: subscribed keys
   * keep their evidence and never see `stale`, so the lamp cannot flicker on every mount. Only an
   * explicit invalidation (`dirty`) fences, because stale evidence must not survive a write.
   */
  private schedule(fenceNow = true) {
    if (this.closed) return;
    clearTimeout(this.retry);
    this.retry = undefined;
    // `subscribe` can be reached while React evaluates a new aggregate atom. Defer the reconnect
    // so it cannot update another render synchronously.
    if (fenceNow && !this.pendingFenced) {
      this.lose(false);
      this.pendingFenced = true;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      clearTimeout(this.retry);
      this.retry = undefined;
      this.pendingFenced = false;
      this.open();
    });
  }

  private open() {
    // Prerender and SSR have no window and no EventSource; the client subscribes again on hydration.
    if (typeof window === "undefined" || this.closed) return;
    if (this.entries.size === 0) {
      this.source?.close();
      this.source = undefined;
      this.retiring?.close();
      this.retiring = undefined;
      clearTimeout(this.watchdog);
      this.unwatchWake?.();
      this.unwatchWake = undefined;
      return;
    }
    this.watchWake();
    const generation = this.generation;
    const url = new URL(this.url());
    url.searchParams.set(
      "keys",
      JSON.stringify([...this.entries.values()].map(({ request }) => request)),
    );
    // The old stream stays open until the replacement opens; its frames are ignored once replaced.
    this.retiring?.close();
    this.retiring = this.source;
    const source = this.connect(url.toString());
    this.source = source;
    const current = () => this.generation === generation && this.source === source;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (current() && [...this.entries.values()].some((entry) => entry.stale)) this.fault();
    }, READING_DEADLINE_MS);
    source.onopen = () => {
      if (!current()) return;
      this.opened = true;
      this.retiring?.close();
      this.retiring = undefined;
      this.recovered();
    };
    const lost = () => {
      if (!current()) return;
      this.fault();
    };
    source.onerror = lost;
    // Socket open proves no reading fresh. Each key must receive its owner acquisition.
    source.onmessage = (event) => {
      if (!current()) return;
      try {
        if (new TextEncoder().encode(event.data as string).byteLength > READING_MAX_FRAME_BYTES)
          throw Error("Reading frame exceeds limit");
        const frame = readingFrameSchema.parse(JSON.parse(event.data as string));
        const entry = this.entries.get(frame.key);
        if (!entry) return;
        const frames = this.pending.get(frame.key) ?? [];
        // Keep log/gap order; consecutive state snapshots need only publish their final value.
        if (frame.kind === "snapshot" && frames.at(-1)?.kind === "snapshot")
          frames[frames.length - 1] = frame;
        else frames.push(frame);
        this.pending.set(frame.key, frames);
        if (!this.cancelDelivery) {
          let delivered = false;
          const cancel = this.batch(() => {
            delivered = true;
            this.cancelDelivery = undefined;
            const pending = [...this.pending];
            this.pending.clear();
            for (const [key, frames] of pending) {
              const entry = this.entries.get(key);
              if (!entry) continue;
              for (const frame of frames) {
                if (frame.kind === "gap") entry.stale = true;
                if (frame.kind === "snapshot" || frame.kind === "failure") {
                  const unchanged =
                    !entry.stale && deepEqual(entry.latest, frame, { ignoreUndefined: false });
                  entry.latest = frame;
                  entry.stale = false;
                  this.attempts = 0;
                  if (unchanged) continue;
                }
                for (const accept of entry.listeners) accept(frame);
              }
            }
          });
          if (!delivered) this.cancelDelivery = cancel;
        }
      } catch {
        lost();
      }
    };
  }
}

export const peReadings = new PeReadings(() =>
  peRouteUrl("resources.stream", {}, resolveWorkbenchConfig().origin),
);

export type Readings = Pick<PeReadings, "subscribe" | "dirty">;
/** What a follower of the owner's liveness holds: `onResync` only. */
export type Liveness = Pick<PeReadings, "onResync">;

/* -- Frames become the one lifecycle ------------------------------------------------------ */

const absent: Reading<never> = { state: "absent" };
const absentAtom = Atom.make<Reading<never>>(absent);

/**
 * Revit changed this Reading's document after the host served it. The host owns the mark; a
 * surface draws this and offers a re-read. A Reading that is not ready is not "changed": its own
 * lifecycle (loading, stale, failed) already says what is known.
 */
export const changedInRevit = (reading: Reading<unknown>): boolean =>
  reading.state === "ready" && reading.changed === true;

export const previousOf = <T>(reading: Reading<T>): T | undefined =>
  reading.state === "ready"
    ? reading.observation
    : reading.state === "absent"
      ? undefined
      : reading.previous;

/** Re-types one Reading's observation without changing its lifecycle or its retained evidence. */
export const mapReading = <A, B>(reading: Reading<A>, project: (value: A) => B): Reading<B> =>
  reading.state === "ready"
    ? { ...reading, observation: project(reading.observation) }
    : reading.state === "stale"
      ? { ...reading, previous: project(reading.previous) }
      : reading.state === "absent"
        ? reading
        : { ...reading, previous: reading.previous ? project(reading.previous) : undefined };

/** One frame advances one Reading. Evidence from before an invalidation is never erased. */
function advance<T>(reading: Reading<T>, frame: Frame): Reading<T> {
  const previous = previousOf(reading);
  switch (frame.kind) {
    case "snapshot":
      if (
        reading.state === "ready" &&
        (reading.changed ?? false) === (frame.changed ?? false) &&
        deepEqual(reading.observation, frame.value, { ignoreUndefined: false })
      )
        return reading;
      return {
        state: "ready",
        observation: frame.value as T,
        ...(frame.changed === undefined ? {} : { changed: frame.changed }),
      };
    case "failure":
      if (reading.state === "failed" && reading.message === frame.error) return reading;
      return { state: "failed", message: frame.error, ...(previous !== undefined && { previous }) };
    case "gap":
      return previous === undefined ? absent : { state: "stale", previous, reason: "gap" };
    case "stale":
      // A fence demotes fresh evidence only. A loading key keeps its first deadline (a reconnect
      // loop cannot postpone its failure forever) and a failure stays said until a frame answers.
      if (reading.state === "loading" || reading.state === "failed") return reading;
      return previous === undefined
        ? { state: "loading", requestId: frame.key, deadline: Date.now() + READING_DEADLINE_MS }
        : { state: "stale", previous, reason: "disconnected" };
    default:
      return reading;
  }
}

const families = new WeakMap<Readings, (key: string) => Atom.Atom<Reading<unknown>>>();
const makeAtoms = (source: Readings) => {
  const family = Atom.family((serialized: string) =>
    Atom.make<Reading<unknown>>((get) => {
      let reading: Reading<unknown> = absent;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const request = JSON.parse(serialized) as ReadingRequest;
      const set = (next: Reading<unknown>) => {
        if (next === reading) return;
        reading = next;
        get.setSelf(reading);
        clearTimeout(deadline);
        // The `loading` state has advertised a deadline since it existed; nothing enforced it, so a
        // host that never answers was a spinner with no end (DELL_PE, 2026-10-12). Now it fails.
        // The kind is the closed subject word; the key names documents and never leaves the tab.
        if (reading.state === "loading") {
          const since = Date.now();
          deadline = setTimeout(
            () => {
              reportFault(
                {
                  code: "reading.timeout",
                  elapsedMs: Date.now() - since,
                  readingKind: request.kind,
                },
                Error(`reading ${serialized}: the host sent nothing before its deadline`),
              );
              set({ state: "failed", message: "The host sent no reading in 30 s." });
            },
            Math.max(0, reading.deadline - since),
          );
        }
      };
      get.addFinalizer(source.subscribe(request, (frame) => set(advance(reading, frame))));
      get.addFinalizer(() => clearTimeout(deadline));
      return reading;
    }).pipe(Atom.setIdleTTL(0)),
  );
  return (key: string) => family(key);
};

/** The only way a View observes anything. One atom per subject, shared by every reader. */
export function readingAtom<T = unknown>(
  request: ReadingRequest,
  source: Readings = peReadings,
): Atom.Atom<Reading<T>> {
  let family = families.get(source);
  if (!family) {
    family = makeAtoms(source);
    families.set(source, family);
  }
  return family(JSON.stringify(readingRequestSchema.parse(request))) as Atom.Atom<Reading<T>>;
}

/** A component's Reading. The request is keyed by subject, so a new object is not a new atom. */
export function useReading<T = unknown>(
  request: ReadingRequest | null,
  source: Readings = peReadings,
): Reading<T> {
  const key = request ? readingKey(request) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const atom = useMemo(
    () => (request ? readingAtom<T>(request, source) : (absentAtom as Atom.Atom<Reading<T>>)),
    [key, source],
  );
  return useAtomValue(atom);
}

export type DuctsNativeObservation = {
  session: string;
  document: { session: string; openId: string } | null;
  requestId: string;
  version: string;
  reused: boolean;
};
type DuctsDecodedBody = { data: unknown; nativeObservation: DuctsNativeObservation; bytes: number };

/** Browser evidence only: immutable Ducts bodies by host revision, never authority or a generic RPC cache. */
export class DuctsBodies {
  private readonly completed = new Map<string, DuctsDecodedBody>();
  private readonly flights = new Map<string, Promise<DuctsDecodedBody>>();
  private bytes = 0;
  constructor(private readonly limits = { entries: 8, bytes: 256 * 1024 * 1024 }) {}

  read(version: string, load: () => Promise<DuctsDecodedBody>): Promise<DuctsDecodedBody> {
    const retained = this.completed.get(version);
    if (retained) {
      this.completed.delete(version);
      this.completed.set(version, retained);
      return Promise.resolve(retained);
    }
    const pending = this.flights.get(version);
    if (pending) return pending;
    if (this.flights.size >= this.limits.entries)
      return Promise.reject(Error("Too many Ducts body reads are pending; refresh to retry"));
    const flight = Promise.resolve()
      .then(load)
      .then((body) => {
        const actual = body.nativeObservation.version;
        const retained = this.completed.get(actual);
        if (retained) return retained;
        if (body.bytes > this.limits.bytes)
          throw Error("Ducts body exceeds the browser byte budget; graph was not clipped");
        while (
          this.completed.size >= this.limits.entries ||
          this.bytes + body.bytes > this.limits.bytes
        ) {
          const oldest = this.completed.keys().next().value!;
          this.bytes -= this.completed.get(oldest)!.bytes;
          this.completed.delete(oldest);
        }
        this.bytes += body.bytes;
        this.completed.set(actual, body);
        return body;
      })
      .finally(() => {
        this.flights.delete(version);
      });
    this.flights.set(version, flight);
    return flight;
  }
}
const ductsBodies = new WeakMap<Readings, DuctsBodies>();
const bodiesOf = (source: Readings) => {
  let bodies = ductsBodies.get(source);
  if (!bodies) {
    bodies = new DuctsBodies();
    ductsBodies.set(source, bodies);
  }
  return bodies;
};

/** Tiny owner envelopes drive acquisition; a graph travels over admitted /call only when needed. */
export function useDuctsReading<T>(
  request: DuctsReadingRequest | null,
  source: Readings = peReadings,
  fetchBody: typeof hostFetch = hostFetch,
) {
  const key = request ? readingKey(request) : null;
  const reading = useReading<DuctsReadingEnvelope>(request, source);
  const envelope =
    reading.state === "ready" ? ductsReadingEnvelopeSchema.parse(reading.observation) : null;
  const current = useRef({ key, envelope });
  current.current = { key, envelope };
  const [body, setBody] = useState<{
    key: string;
    data?: T;
    nativeObservation?: DuctsNativeObservation;
    error?: Error;
    revision: string;
  }>();
  const attempts = useRef(new Map<string, Promise<void>>());
  const acquire = useCallback(
    (refresh = false) => {
      const at = current.current;
      if (!request || !at.key || !at.envelope) return;
      const { revision, version, session, target } = at.envelope;
      const attempt = `${at.key}:${revision}:${refresh}`;
      if (attempts.current.has(attempt)) return;
      const headers: Record<string, string> = {
        [HOST_RPC_BRIDGE_SESSION_HEADER]: session,
        [HOST_RPC_ORIGIN_HEADER]: `web:${window.location.pathname}`,
      };
      if (target) headers[HOST_RPC_DOCUMENT_HEADER] = target.openId;
      if (refresh) headers[DUCTS_REFRESH_HEADER] = revision;
      else if (version) headers[DUCTS_BODY_VERSION_HEADER] = version;
      const promise = (async () => {
        try {
          const decoded = await bodiesOf(source).read(
            refresh ? `refresh:${revision}` : revision,
            async () => {
              const response = await createPeClient(undefined, fetchBody).response(
                "operation.call",
                {
                  body:
                    request.kind === "ducts-snapshot"
                      ? {
                          key: "ducts.snapshot",
                          request: {
                            ...(request.slots ? { slots: request.slots } : {}),
                            ...(request.labelParameter
                              ? { labelParameter: request.labelParameter }
                              : {}),
                          },
                        }
                      : { key: "ducts.tables", request: { ids: request.ids } },
                },
                { headers, signal: AbortSignal.timeout(120_000) },
              );
              if (!response.ok) {
                const problem = (await response.json().catch(() => null)) as {
                  message?: string;
                  error?: string;
                } | null;
                throw Error(
                  problem?.message ?? problem?.error ?? `Ducts read failed (${response.status})`,
                );
              }
              const confirmedSession = response.headers.get("x-pe-resolved-session");
              const confirmedOpenId = response.headers.get("x-pe-resolved-open-id");
              const nativeRequestId = response.headers.get("x-pe-native-request-id");
              const bodyVersion = response.headers.get(DUCTS_BODY_VERSION_HEADER);
              if (
                confirmedSession !== session ||
                (target && decodeURIComponent(confirmedOpenId ?? "") !== target.openId) ||
                !nativeRequestId ||
                !bodyVersion ||
                (version && !refresh && bodyVersion !== version)
              )
                throw Error("Ducts response did not confirm the requested observation");
              const json = await response.text();
              return {
                data: JSON.parse(json) as unknown,
                bytes: new TextEncoder().encode(json).byteLength,
                nativeObservation: {
                  session,
                  document: target,
                  requestId: nativeRequestId,
                  version: bodyVersion,
                  reused: response.headers.get("x-pe-ducts-reused") === "true",
                },
              };
            },
          );
          const latest = current.current;
          // HTTP may beat the ready SSE frame, but an older revision can never overwrite a newer body.
          if (
            latest.key !== at.key ||
            latest.envelope?.revision !== decoded.nativeObservation.version ||
            !["idle", "loading", "ready"].includes(latest.envelope.state)
          )
            return;
          setBody({
            key: at.key!,
            data: decoded.data as T,
            revision: decoded.nativeObservation.version,
            nativeObservation: decoded.nativeObservation,
          });
        } catch (error) {
          if (current.current.key === at.key && current.current.envelope?.revision === revision)
            setBody({
              key: at.key!,
              revision,
              error: Error(
                `${error instanceof Error ? error.message : String(error)}; refresh to retry`,
              ),
            });
        }
      })();
      attempts.current.set(attempt, promise);
      // Attempts only deduplicate this mounted consumer; the host owns every completed payload.
      if (attempts.current.size > 8) attempts.current.delete(attempts.current.keys().next().value!);
    },
    [key, fetchBody, source],
  );
  useEffect(() => {
    if (
      !envelope ||
      envelope.state === "loading" ||
      envelope.state === "failed" ||
      envelope.state === "closed"
    )
      return;
    // A failed attempt is observable until explicit refresh; rendering never spins network retries.
    if (body?.key === key && body.revision === envelope.revision) return;
    // The same acquisition's ready envelope can arrive before its HTTP response.
    if (envelope.state === "ready" && attempts.current.has(`${key}:${envelope.revision}:false`))
      return;
    acquire();
  }, [key, envelope?.revision, envelope?.state, body, acquire]);
  const valid =
    envelope?.state === "ready" &&
    body?.key === key &&
    body.nativeObservation?.version === envelope.version;
  const error =
    reading.state === "failed"
      ? Error(reading.message)
      : envelope?.error
        ? Error(envelope.error)
        : body?.key === key && body.revision === envelope?.revision
          ? body.error
          : undefined;
  return {
    data: valid ? body.data : undefined,
    nativeObservation: valid ? body.nativeObservation : undefined,
    version: valid ? body.nativeObservation?.version : undefined,
    error,
    pending: request !== null && !valid && !error,
    refresh: useCallback(() => acquire(true), [acquire]),
  };
}

/**
 * The slice of a Reading a component uses. A frame that leaves the slice structurally equal does not
 * notify, so a poll that moved other fields re-renders nobody here.
 */
export function useReadingSlice<T, S>(
  request: ReadingRequest | null,
  select: (reading: Reading<T>) => S,
  source: Readings = peReadings,
): S {
  const key = request ? readingKey(request) : null;
  const selectRef = useRef(select);
  selectRef.current = select;
  const registry = useContext(RegistryContext);
  const atom = useMemo(
    () => (request ? readingAtom<T>(request, source) : (absentAtom as Atom.Atom<Reading<T>>)),
    [key, source],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const held = useRef<{ value: S } | undefined>(undefined);
  const subscribe = useCallback(
    (notify: () => void) => registry.subscribe(atom, notify),
    [registry, atom],
  );
  const snapshot = useCallback(() => {
    const value = selectRef.current(registry.get(atom));
    if (held.current && deepEqual(held.current.value, value, { ignoreUndefined: false }))
      return held.current.value;
    held.current = { value };
    return value;
  }, [registry, atom]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The `host-status` slice a component uses; see `useReadingSlice`. */
export const useHostStatusSlice = <S>(select: (reading: Reading<PeInfo>) => S, enabled = true): S =>
  useReadingSlice<PeInfo, S>(enabled ? { kind: "host-status" } : null, select);

/** An Action succeeded; this subject's snapshot is reacquired from the host. */
export const dirty = (request: ReadingRequest, source: Readings = peReadings) =>
  source.dirty(request);

/** Imperative readers join the stream and release only their observation. */
export function readReading(
  request: ReadingRequest,
  signal: AbortSignal = AbortSignal.timeout(30_000),
  source: Readings = peReadings,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let release = () => {};
    let settled = false;
    const finish = (value?: unknown, error?: unknown) => {
      if (settled) return;
      settled = true;
      release();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(undefined, signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    release = source.subscribe(request, (frame) => {
      if (frame.kind === "snapshot" && !frame.stale) finish(frame.value);
      else if (frame.kind === "failure" && !frame.stale) finish(undefined, Error(frame.error));
    });
    if (settled) release();
  });
}

/* -- TakeoffModel events: the one push channel that is not a subject ----------------------------- */

function subscribeHostEvents<T>(listener: (event: T) => void): () => void {
  return peReadings.subscribe({ kind: "world" }, (frame) => {
    if (frame.kind === "event") listener(frame.value as T);
    else if (frame.kind === "gap" || frame.kind === "stale")
      listener({
        kind: "gap",
        atMs: Date.now(),
        sessionId: "",
        dropped: frame.kind === "gap" ? frame.dropped : null,
      } as T);
  });
}

export function useHostEvents<T>(enabled: boolean, onEvent: (event: T) => void) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeHostEvents(onEvent);
  }, [enabled, onEvent]);
}

/* -- host-status: one subject, one cadence, both the gate read and the lamp ---------------- */

export interface PeInfo {
  controllerId?: string;
  capabilities: { revit?: boolean } & Record<string, unknown>;
  world?: unknown;
  bridgeIsConnected: boolean;
}

/* -- Inventory: the open documents the host tracks, fused with the SDK census -------------- */

/** One Revit process incarnation, as observed by the broker. */
export interface SessionInventory {
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  sessionId: string;
  processId: number;
  processStartUtcUnixMs?: number | null;
  lane: Lane | null;
  /** The id `pe-revit session list` prints, when this payload was launched by pe-revit. */
  sdkSessionId?: string;
  year?: string;
  /** Disclosed by the broker. The UI never re-implements the SDK's `observed` refusal. */
  custody: Custody;
  activeDocumentId?: string;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  openDocuments?: BridgeSessionListEntry["openDocuments"];
  openDocumentId?: string;
  observedAtUnixMs?: number;
}

const CUSTODIES: readonly Custody[] = ["controlled", "observed"];
const LANES: readonly Lane[] = ["dev", "installed"];

/** Wire entry (bridge.sessions.list) into inventory. Disconnected entries are not targets. */
export function inventoryOf(entries: readonly BridgeSessionListEntry[]): SessionInventory[] {
  return entries
    .filter((e) => e.connected)
    .map((e) => ({
      sessionId: e.sessionId,
      processId: e.processId ?? 0,
      processStartUtcUnixMs: e.processStartUtcUnixMs ?? null,
      // Anything outside the SDK's union is no lane at all, not an invented "unknown" member.
      lane: LANES.find((l) => l === e.lane) ?? null,
      sdkSessionId: e.sdkSessionId ?? undefined,
      year: e.revitVersion ?? undefined,
      // An entry that predates `custody` is treated as observed: the read-only reading.
      custody: CUSTODIES.find((c) => c === e.custody) ?? "observed",
      activeDocumentId: e.activeDocumentCloudModelGuid ?? e.activeDocumentPath ?? undefined,
      activeDocumentTitle: e.activeDocumentTitle ?? undefined,
      observedAtUnixMs: e.activeDocumentObservedAtUnixMs ?? undefined,
      openDocumentCount: e.openDocumentCount,
      openDocuments: e.openDocuments,
    }));
}

/** The tracked open-document inventory, as the broker publishes it. */
export const useInventory = (enabled = true) =>
  useReading<{ sessions: BridgeSessionListEntry[] }>(enabled ? { kind: "inventory" } : null);

/**
 * The one Reading, as the one Target resolver reads it. A Reading that has not yet observed is
 * `checking`; a failed Reading says why; nothing here invents a session the host did not report.
 */
export function targetInventory(
  reading: Reading<{ sessions: BridgeSessionListEntry[] }>,
): TargetInventory {
  if (reading.state === "failed") return { kind: "failed", message: reading.message };
  const seen = previousOf(reading);
  if (!seen) return { kind: "checking" };
  const sessions: Record<
    string,
    {
      kind: "ready";
      values: { openId: string; address: Address | null; kind: "project" | "family" }[];
    }
  > = {};
  for (const session of inventoryOf(seen.sessions)) {
    sessions[session.sessionId] = {
      kind: "ready",
      values: (session.openDocuments ?? []).map((doc) => ({
        openId: doc.openId,
        address: addressSchema.safeParse(doc.address).data ?? null,
        kind: doc.isFamilyDocument ? ("family" as const) : ("project" as const),
      })),
    };
  }
  return { kind: "ready", sessions };
}

/* -- Host RPC: a call, not a subject ------------------------------------------------------ */

/**
 * Calls in flight by their deps. A remount (or a second component) asking the same thing joins
 * the pending call instead of queueing another: Revit runs one op at a time and refuses past 8
 * waiting (`ducts.snapshot` remounts filled it). A `refresh` always starts a fresh call.
 */
const inflight = new Map<string, Promise<unknown>>();
const flightKey = (deps: readonly unknown[]) => {
  try {
    return JSON.stringify(deps);
  } catch {
    return null;
  }
};

/**
 * A host operation read on mount. Not a Reading: it has no subject key and no owner, so it
 * carries no cache and no revalidation. Call `refresh` after a write that changes its answer.
 */
export function useHostCall<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
  /** Unanswered past this, the read ends as an error ("no answer after Ns") and is aborted. */
  waitSeconds = HOST_READ_WAIT_S,
  /** Deps name the call completely (an op key and its request), so equal deps may share it. */
  shared = false,
) {
  const identity = useRef({ deps: [...deps], generation: 0 });
  if (!sameDeps(identity.current.deps, deps)) {
    identity.current = { deps: [...deps], generation: identity.current.generation + 1 };
  }
  const generation = identity.current.generation;
  const [state, setState] = useState<{
    data?: T;
    error?: Error;
    pending: boolean;
    generation: number;
  }>({ pending: enabled, generation });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ pending: false, generation });
      return;
    }
    const controller = new AbortController();
    setState((current) =>
      current.generation === generation
        ? { ...current, pending: true }
        : { pending: true, generation },
    );
    // A read that never answers ends honestly, never as an endless "reading…" (F-J1-4).
    const wait = setTimeout(() => {
      if (controller.signal.aborted) return;
      controller.abort();
      setState({ error: Error(`no answer after ${waitSeconds}s`), pending: false, generation });
    }, waitSeconds * 1000);
    const key = shared ? flightKey(deps) : null;
    const joined =
      key !== null && nonce === 0 ? (inflight.get(key) as Promise<T> | undefined) : undefined;
    // A shared call outlives the mount that started it, so no one mount's abort cancels it.
    const call = joined ?? run(key !== null ? new AbortController().signal : controller.signal);
    if (key !== null && !joined) {
      inflight.set(key, call);
      void call.then(
        () => inflight.get(key) === call && inflight.delete(key),
        () => inflight.get(key) === call && inflight.delete(key),
      );
    }
    void call
      .finally(() => clearTimeout(wait))
      .then(
        (data) => {
          if (!controller.signal.aborted) setState({ data, pending: false, generation });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setState({ error: Error(String(error)), pending: false, generation });
        },
      );
    return () => {
      clearTimeout(wait);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const visible =
    enabled && state.generation === generation
      ? state
      : { data: undefined, error: undefined, pending: enabled };
  return {
    data: visible.data,
    error: visible.error,
    pending: visible.pending,
    isPending: visible.pending,
    isLoading: visible.pending,
    isSuccess: !visible.pending && visible.error === undefined && visible.data !== undefined,
    refresh,
  };
}

function sameDeps(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

/**
 * An Action's run, as a component holds it: at most one in flight, its refusal kept, and its
 * success dirtying whatever Readings it names. Not a cache and not a queue.
 */
export function useAction<I, T>(
  run: (input: I) => Promise<T>,
  onSuccess?: (value: T, input: I) => void,
) {
  const [state, setState] = useState<{ pending: boolean; error?: Error }>({ pending: false });
  const mutateAsync = useCallback(
    async (input: I) => {
      setState({ pending: true });
      try {
        const value = await run(input);
        setState({ pending: false });
        onSuccess?.(value, input);
        return value;
      } catch (error) {
        setState({ pending: false, error: Error(String(error)) });
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, onSuccess],
  );
  return {
    mutate: (input: I) => void mutateAsync(input).catch(() => {}),
    mutateAsync,
    isPending: state.pending,
    error: state.error,
  };
}

/* -- Host RPC reads: not Readings, just one call each over the one /call endpoint ------------ */

export const HOST_QUERY_KEY = ["pe-host"] as const;

type HostQueryOptions = HostSessionScope & {
  readonly enabled?: boolean;
  /** How long the read may go unanswered; default `HOST_READ_WAIT_S`. */
  readonly waitSeconds?: number;
};

/** Any operation key becomes a one-shot read. A Reading is for a subject the host pushes. */
export function useHostOp<K extends OpKey>(key: K, ...args: OpCallArgs<K, HostQueryOptions>) {
  const [request, options] = args;
  const { enabled, bridgeSessionId, openDocumentId, waitSeconds } = options ?? {};
  const scope = { bridgeSessionId, openDocumentId };
  return useHostCall(
    // Cast: TS cannot resolve the conditional OpCallArgs tuple while K is open; the public
    // signatures on this hook and callHostRpc enforce it at call sites.
    () => callHostRpc(key, ...([request, scope] as OpCallArgs<K, HostSessionScope>)),
    [
      ...HOST_QUERY_KEY,
      bridgeSessionId ?? "",
      key,
      JSON.stringify(request ?? null),
      openDocumentId ?? "",
    ],
    enabled ?? true,
    waitSeconds,
    true,
  );
}

/** A value domain's options (the `revit.catalog.field-options` answer). */
export type FieldOptionsData = HostOpResponse<"revit.catalog.field-options">;

/**
 * The one door to a field's options: an `x-options.key` read from one named document, with the
 * context values its `dependsOn` names. No document or no key reads nothing. A LiveDocument key's
 * Reading carries Revit's change mark (`changedInRevit`).
 */
export const useFieldOptionsReading = (
  target: { session: string; openId: string } | null | undefined,
  key: string | undefined,
  context: Record<string, string> = {},
): Reading<FieldOptionsData> =>
  useReading<FieldOptionsData>(
    target && key
      ? {
          kind: "field-options",
          target: { session: target.session, openId: target.openId },
          key,
          context,
        }
      : null,
  );
