import { currentFixture } from "../shell/fixture-name";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { hostFetch, runtimeStreamUrl } from "#/host/runtime";
/**
 * The wire. One EventSource per tab: SSE frames, fences, reconnect backoff.
 *
 * This module is a transport only. Host resource snapshots and typed Values own their lifecycle; this module carries frames only. A write is
 * not a Reading: it is a plain async call whose success calls `dirty(request)`, which reacquires
 * that subject's snapshot from the host.
 */
import {
  READING_MAX_FRAME_BYTES,
  READING_MAX_KEYS,
  readingFrameSchema,
  readingKey,
  readingRequestSchema,
  type ReadingFrame,
  type ReadingRequest,
  actionReceiptSchema,
} from "@pe/agent-contracts";
import { bindActionObserver } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { useEffect, useRef } from "react";
import { reportFault } from "#/host/diagnostics";
import { resolveWorkbenchConfig } from "#/workbench/config.ts";
import { deepEqual } from "@tanstack/react-router";
/* -- The one wire ------------------------------------------------------------------------- */

type Frame = (ReadingFrame & { stale?: boolean }) | { kind: "stale"; key: string };
type Source = Pick<EventSource, "onopen" | "onmessage" | "onerror" | "close">;

/** How long a fresh connection may stay silent with keys unanswered; past it the connection is dead. */
const READING_DEADLINE_MS = 30_000;
/** Reconnect delays double from 1 s to this ceiling, and reset on the first fresh frame. */
const RETRY_CEILING_MS = 30_000;

/** The one place the web opens an SSE stream: Readings, and a harness thread's tail. */
// TODO: docs/features/routes/LEDGER.md#s7-500118f3a3 Fold cursor-resuming thread tails into this transport with the composer owner; they still use a separate SSE.
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
  // Keep 64 inactive subjects: several dozen recent revisits; mounted readings live in entries.
  private readonly retainedLimit = 64;
  private readonly retained = new Map<string, ReadingFrame>();
  private source?: Source;
  private connection = "";
  private sent = new Map<string, ReadingRequest>();
  private updating = false;
  private readonly renew = new Set<string>();
  /** A replacement cannot retire the active stream until it has opened. */
  private opening?: Source;
  private generation = 0;
  private observationEpoch = 0;
  private scheduled = false;
  private pendingFenced = false;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;
  /** A stream opened since the last loss: its loss is one fault, its reconnect attempts are not. */
  private opened = false;
  /** Reconnects since the last fresh frame; the next delay is 1 s doubled this many times. */
  private attempts = 0;
  /** A connection that opened and delivered nothing by the deadline, with keys unanswered, is faulted. */
  private watchdog?: ReturnType<typeof setTimeout>;
  /** A connection fault happened; the next open tells every resync listener to re-read. */
  private faulted = false;
  private readonly resyncs = new Set<() => void>();
  private unwatchWake?: () => void;
  private readonly pending = new Map<string, Frame[]>();
  private cancelDelivery?: () => void;

  constructor(
    private readonly url: () => string,
    private readonly connect: (url: string) => Source = openEventSource,
    private readonly batch: (deliver: () => void) => () => void = (deliver) => {
      // Transport progress must not depend on a paint: a visible tab can become occluded
      // after scheduling, leaving an rAF (and all later frames) stranded indefinitely.
      const timer = setTimeout(deliver, 0);
      return () => clearTimeout(timer);
    },
    private readonly update: (
      connection: string,
      add: ReadingRequest[],
      remove: string[],
    ) => Promise<void> = async (connection, add, remove) => {
      const url = new URL(
        peRouteUrl("resources.subscriptions", {}, resolveWorkbenchConfig().origin),
      );
      url.searchParams.set("connection", connection);
      const response = await hostFetch(url.href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ add, remove }),
      });
      if (!response.ok) throw Error(`Reading subscriptions: ${response.status}`);
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
    this.opening?.close();
    this.opening = undefined;
    this.entries.clear();
    this.renew.clear();
    this.retained.clear();
    this.resyncs.clear();
    this.unwatchWake?.();
    this.unwatchWake = undefined;
  }

  /**
   * Transports this owner cannot carry (a thread's log tail, which resumes from its own cursor)
   * follow its liveness: the listener runs when the connection reopens after a connection fault,
   * and re-reads its own state from the host. One owner decides when the world is suspect.
   */
  onResync(listener: () => void): () => void {
    this.resyncs.add(listener);
    return () => void this.resyncs.delete(listener);
  }

  /**
   * The stream lost contact with its host:
   * fence every key, reconnect now, and have every follower re-read. Coalesced per tick, so a
   * burst of recovery signals is one reconnect.
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
    this.lose();
  }

  private watchWake() {
    if (this.unwatchWake || typeof document === "undefined") return;
    // Visibility is not a change of basis. The live stream keeps delivering while hidden.
    let offline = false;
    const lostNetwork = () => {
      offline = true;
    };
    const online = () => {
      if (offline || this.faulted) {
        offline = false;
        this.resync();
      }
    };
    window.addEventListener("offline", lostNetwork);
    window.addEventListener("online", online);
    this.unwatchWake = () => {
      window.removeEventListener("offline", lostNetwork);
      window.removeEventListener("online", online);
    };
  }

  subscribe(raw: ReadingRequest, listener: (frame: Frame) => void): () => void {
    if (this.closed) throw Error("This Pe reading owner is retired");
    const request = readingRequestSchema.parse(raw);
    if (currentFixture() !== null) {
      listener({
        kind: "failure",
        key: readingKey(request),
        error: "Fixture lane: use the graph seed reading",
      });
      return () => {};
    }
    const key = readingKey(request);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { request, listeners: new Set(), latest: this.retained.get(key), stale: true };
      this.retained.delete(key);
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
        if (found.latest) {
          this.retained.delete(key);
          this.retained.set(key, found.latest);
          if (this.retained.size > this.retainedLimit)
            this.retained.delete(this.retained.keys().next().value!);
        }
        this.entries.delete(key);
        this.pending.delete(key);
        this.schedule(false);
      }
    };
  }

  /** Writes fence the connection. Receipt-window loss renews only that subject: it is not
   * evidence that Work changed. A gap diagnoses loss; the replacement snapshot restores it. */
  dirty(request: ReadingRequest, scope: "connection" | "subject" = "connection") {
    const key = readingKey(request), entry = this.entries.get(key);
    if (!entry) return;
    if (scope === "connection") return this.schedule();
    this.pending.delete(key);
    this.renew.add(key);
    entry.stale = true;
    for (const accept of entry.listeners) accept({ kind: "stale", key });
    this.schedule(false);
  }

  /** Invalidation revokes evidence, not the live command channel. Only the replacement may
   * acquire evidence again; queued and later snapshots from the old stream cannot do so. */
  private fence() {
    this.observationEpoch++;
    for (const [key, frames] of this.pending) {
      const events = frames.filter((frame) => frame.kind === "event" || frame.kind === "gap");
      if (events.length) this.pending.set(key, events);
      else this.pending.delete(key);
    }
    if (this.pending.size === 0) {
      this.cancelDelivery?.();
      this.cancelDelivery = undefined;
    }
    for (const [key, entry] of this.entries) {
      entry.stale = true;
      for (const accept of entry.listeners) accept({ kind: "stale", key });
    }
  }

  private lose() {
    this.cancelDelivery?.();
    this.cancelDelivery = undefined;
    this.pending.clear();
    this.generation++;
    clearTimeout(this.watchdog);
    this.source?.close();
    this.source = undefined;
    this.opening?.close();
    this.opening = undefined;
    this.fence();
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
      this.fence();
      this.pendingFenced = true;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      clearTimeout(this.retry);
      this.retry = undefined;
      const fenced = this.pendingFenced;
      this.pendingFenced = false;
      if (!fenced && (this.source || this.opening)) void this.syncSubscriptions();
      else this.open();
    });
  }

  private async syncSubscriptions() {
    if (this.updating || !this.source || this.opening || this.closed) return;
    this.updating = true;
    const connection = this.connection;
    const generation = this.generation;
    try {
      while (!this.closed && this.connection === connection && this.generation === generation) {
        const remove = [...this.sent.keys()]
          .filter((key) => !this.entries.has(key) || this.renew.has(key))
          .slice(0, READING_MAX_KEYS);
        const add = [...this.entries]
          .filter(([key]) => !this.sent.has(key))
          .slice(0, READING_MAX_KEYS);
        if (remove.length || add.length) {
          for (const [key] of add) this.renew.delete(key);
          // Subscription admission remains authoritative: failure still fences the live wire.
          await this.update(connection, add.map(([, entry]) => entry.request), remove);
          if (this.closed || this.connection !== connection || this.generation !== generation) break;
          for (const key of remove) this.sent.delete(key);
          for (const [key, entry] of add) this.sent.set(key, entry.request);
          continue;
        }
        break;
      }
    } catch {
      if (!this.closed && this.connection === connection && this.generation === generation) this.fault();
    } finally {
      this.updating = false;
      if (!this.closed && (this.connection !== connection || this.generation !== generation)) void this.syncSubscriptions();
    }
  }

  private open() {
    // Prerender and SSR have no window and no EventSource; the client subscribes again on hydration.
    if (typeof window === "undefined" || this.closed) return;
    if (this.entries.size === 0) {
      this.source?.close();
      this.source = undefined;
      this.opening?.close();
      this.opening = undefined;
      clearTimeout(this.watchdog);
      this.unwatchWake?.();
      this.unwatchWake = undefined;
      return;
    }
    this.watchWake();
    const generation = this.generation;
    const observationEpoch = this.observationEpoch;
    const url = new URL(this.url());
    url.searchParams.delete("keys");
    this.connection = crypto.randomUUID();
    url.searchParams.set("connection", this.connection);
    this.sent = new Map();
    // Topology changes can overtake a still-opening replacement. Retire that candidate, not the
    // active stream: commands remain live while the newest connection acquires its keys.
    this.opening?.close();
    const source = this.connect(url.toString());
    this.opening = source;
    const current = () =>
      this.generation === generation && (this.source === source || this.opening === source);
    // The watchdog judges the wire, not each owner's speed. A stream that has delivered any frame
    // since it opened is alive; a key still unanswered is slow (Revit runs one op at a time, so a
    // 60 s native read starves every Revit-backed reading behind it). Faulting then fenced healthy
    // keys, withdrew a capture's document, aborted the capture and re-asked it every 31 s
    // (2026-10-31). Only a stream that opened and stayed silent is dead.
    let heard = false;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (current() && !heard && [...this.entries.values()].some((entry) => entry.stale))
        this.fault();
    }, READING_DEADLINE_MS);
    source.onopen = () => {
      if (!current() || this.opening !== source) return;
      this.source?.close();
      this.source = source;
      this.opening = undefined;
      this.opened = true;
      this.recovered();
      void this.syncSubscriptions();
    };
    const lost = () => {
      if (!current()) return;
      this.fault();
    };
    source.onerror = lost;
    // Socket open proves no reading fresh. Each key must receive its owner acquisition.
    source.onmessage = (event) => {
      if (!current() || (this.source !== undefined && this.source !== source)) return;
      heard = true;
      try {
        if (new TextEncoder().encode(event.data as string).byteLength > READING_MAX_FRAME_BYTES)
          throw Error("Reading frame exceeds limit");
        const frame = readingFrameSchema.parse(JSON.parse(event.data as string));
        if (
          (frame.kind === "snapshot" || frame.kind === "failure") &&
          observationEpoch !== this.observationEpoch
        )
          return;
        const entry = this.entries.get(frame.key);
        if (!entry) return;
        if (this.renew.has(frame.key)) return;
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
              for (let frame of frames) {
                if (frame.kind === "gap") entry.stale = true;
                if (frame.kind === "snapshot" || frame.kind === "failure") {
                  const identical = deepEqual(entry.latest, frame, { ignoreUndefined: false });
                  const unchanged = !entry.stale && identical;
                  // A new stream must confirm freshness, but identical evidence keeps its identity.
                  if (identical && entry.latest) frame = entry.latest;
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

/** Accepted commands observe the same receipt owner as the rest of the page. */
export function bindActionReadings(source: Readings = peReadings): () => void {
  return bindActionObserver((id, base, accept, fail) => {
    const owner = new URL(resolveWorkbenchConfig().origin);
    const requested = new URL(base || "/", owner);
    if (requested.origin !== owner.origin || requested.pathname !== "/") {
      fail(Error("This receipt stream belongs to a different host"));
      return () => {};
    }
    return source.subscribe({ kind: "receipts", id }, (frame) => {
      if (frame.kind === "failure" && !frame.stale) fail(Error(frame.error));
      if (frame.kind !== "snapshot" || frame.stale) return;
      const rows = actionReceiptSchema.array().safeParse(frame.value);
      if (!rows.success) return fail(rows.error);
      const row = rows.data.find((candidate) => candidate.id === id);
      if (row) accept(row);
    });
  });
}
/** What a follower of the owner's liveness holds: `onResync` only. */
export type Liveness = Pick<PeReadings, "onResync">;

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
  // Overlapping streams can carry the same live command. Consumption is once per follower,
  // across callback re-subscriptions; this bounded memory never replays an old command.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    return subscribeHostEvents<T>((event) => {
      const command = event as { type?: unknown; commandId?: unknown } | null;
      if (
        command &&
        (command.type === "route-view-open" || command.type === "route-view-intent") &&
        typeof command.commandId === "string"
      ) {
        if (seen.current.has(command.commandId)) return;
        seen.current.add(command.commandId);
        if (seen.current.size > 64) seen.current.delete(seen.current.values().next().value!);
      }
      onEvent(event);
    });
  }, [enabled, onEvent]);
}
