/**
 * A read as subscribers see it: one publication slot per subscription, one shared flight per
 * admitted input set, one lease per subscriber. The host owns the read's lifetime here; the
 * evaluator beside it only runs a recipe once.
 */
import {
  evaluate,
  fingerprint,
  immutable,
  RefreshNeeded,
  schemaId,
  type InputPort,
  type InputRevision,
  type Read,
  type Trace,
  type Value,
} from "@pe/host-internal/reads/evaluator";
import { startFlight, type Flight, type ReadLease } from "./read-ownership.ts";
import { ReadBusy } from "@pe/host-internal/read-errors";
import type { QueueHolder } from "@pe/agent-contracts/value";
import type { ReadingDemand } from "@pe/host-internal/native-read";
import { CompletedReads } from "./completed-reads.ts";

export interface Publication<T> {
  readonly key: string;
  readonly generation: number;
  readonly version: number;
  readonly value: Value<T> | null;
  readonly state: "current" | "refresh-needed" | "superseded";
  readonly reason?: string;
  readonly refreshCause?: "document-changed";
}
type Dependency = Pick<Trace, "name" | "args">;
type Pending = {
  inputs: Dependency[];
  demands: Set<ReadingDemand>;
  basis: InputRevision[];
  superseded: boolean;
  timelineInvalidated?: boolean;
};
type PublicationListener = (replacement?: Publication<unknown>, retry?: number) => void;
type Slot = {
  generation: number;
  key: string;
  published?: Publication<unknown>;
  inputRaced?: boolean;
  attempt: number;
  pending?: Pending;
  lease?: ReadLease;
};
type Admission = {
  count: number;
  generation: number;
  holderOwner?: object;
  holder?: QueueHolder;
  holderVersion?: number;
};
type HolderListener = (generation: number, holder: QueueHolder, version: number) => void;
/** How a publication starts its shared read. Pass `(run) => ownership.flight(owner, run)` to bind it to a `ReadOwner`. */
export type StartFlight = <T>(run: (signal: AbortSignal) => Promise<T>) => Flight<T>;
/** One entry per (read,args), one generation per client subscription; no client acknowledgement. */
export class Publications {
  private readonly slots = new Map<string, Slot>();
  private readonly waiting = new Map<string, Pick<Publication<unknown>, "key" | "generation">>();
  private retryVersion = 0;
  private readonly released = new Map<string, number>();
  private readonly admissions = new Map<string, Admission>();
  private readonly holderListeners = new Map<string, Set<HolderListener>>();
  private holderVersion = 0;
  private readonly completed = new CompletedReads();
  private readonly retainedBytes = new Map<string, number>();
  private bytes = 0;
  private readonly keys = new Map<
    string,
    { version: number; flights: Map<string, Flight<Publication<unknown>>> }
  >();
  private readonly listeners = new Map<string, Set<PublicationListener>>();
  private readonly flightInputs = new WeakMap<Flight<Publication<unknown>>, Pending>();
  constructor(
    private readonly capacity = 128,
    private readonly byteLimit = 128 * 1024 * 1024,
    private readonly open: StartFlight = startFlight,
  ) {}
  observe(id: string, notify: (publication: Publication<unknown>, retry?: number) => void) {
    const listeners = this.listeners.get(id) ?? new Set<PublicationListener>();
    const listener: PublicationListener = (replacement, retry) => {
      const value = replacement ?? this.slots.get(id)?.published;
      if (value) notify(value, retry);
    };
    listeners.add(listener);
    this.listeners.set(id, listeners);
    listener();
    return () => {
      listeners.delete(listener);
      if (!listeners.size && this.listeners.get(id) === listeners) {
        this.listeners.delete(id);
        this.discard(id);
        this.pruneReleased();
      }
    };
  }
  private notify(id: string, replacement?: Publication<unknown>, retry?: number) {
    const listeners = this.listeners.get(id);
    for (const listener of listeners ?? []) {
      try {
        listener(replacement, retry);
      } catch {
        listeners?.delete(listener);
      }
    }
  }
  observeHolder(id: string, notify: HolderListener) {
    const listeners = this.holderListeners.get(id) ?? new Set<HolderListener>();
    this.holderListeners.set(id, listeners);
    listeners.add(notify);
    const active = this.admissions.get(id);
    if (active?.holder !== undefined && active.holderVersion !== undefined)
      notify(active.generation, active.holder, active.holderVersion);
    return () => {
      listeners.delete(notify);
      if (!listeners.size) this.holderListeners.delete(id);
    };
  }
  history() {
    return immutable(
      Object.fromEntries(
        [...this.slots.keys()].flatMap((id) => {
          const published = this.publication(id);
          return published
            ? [
                [
                  id,
                  {
                    key: published.key,
                    version: published.version,
                    evaluation: published.value?.evaluation,
                  },
                ],
              ]
            : [];
        }),
      ),
    );
  }
  /** Retained bytes do not make a released or superseded subscription open. */
  publication(id: string) {
    const slot = this.slots.get(id),
      published = slot?.published;
    if (
      !slot?.key ||
      !published ||
      published.generation !== slot.generation ||
      published.key !== slot.key
    )
      return undefined;
    return published;
  }
  invalidate(matches: (trace: Dependency) => boolean, subscription?: string) {
    const changesTimeline = (input: Dependency) => input.name === "work-timeline" && matches(input);
    const documentChanged = (input: Dependency) => input.name === "document-mark" && matches(input);
    const slots =
      subscription === undefined
        ? this.slots
        : [[subscription, this.slots.get(subscription)] as const];
    for (const [id, slot] of slots) {
      if (!slot) continue;
      const previous = slot.published;
      const pending = slot.pending?.inputs.some((input) => input.name === "work" && matches(input));
      const pendingTimeline = slot.pending?.inputs.some(changesTimeline);
      if (pendingTimeline && slot.pending) slot.pending.timelineInvalidated = true;
      if (pending || pendingTimeline || previous?.value?.trace.some(matches)) {
        // Work creation or editing replaces the pending basis, including the first publication.
        if (pending && slot.pending) {
          slot.pending.superseded = true;
          slot.attempt++;
          slot.pending = undefined;
          slot.lease?.release();
          slot.lease = undefined;
        }
        slot.published = immutable({
          key: previous?.key ?? slot.key,
          generation: slot.generation,
          version: previous?.version ?? 0,
          state: "refresh-needed",
          ...(previous?.value?.trace.some(documentChanged) && { refreshCause: "document-changed" }),
          value: previous?.value ? { ...previous.value, freshness: "refresh-needed" } : null,
        });
        // The tab can be refreshing a retained Timeline Value when another receipt lands.
        // Give that invalidation a distinct wire identity even when the Value's version stands.
        const timeline = pendingTimeline || previous?.value?.trace.some(changesTimeline);
        this.notify(id, undefined, timeline ? ++this.retryVersion : undefined);
      }
    }
  }
  /** Claim one retry for a retained read after a newer input observation. */
  takeRacedRead(id: string, generation: number) {
    const slot = this.slots.get(id);
    const published = this.publication(id);
    if (!slot?.inputRaced || slot.pending || slot.generation !== generation || !published?.value)
      return;
    slot.inputRaced = false;
    return published;
  }
  /** Pin only this ID's release fence before opening inputs; close on every request exit. */
  admission(
    id: string,
    generation: number,
    watchHolder?: (notify: (holder: QueueHolder) => void) => () => void,
  ) {
    const holders = this.listeners.get(id);
    const admission = this.admissions.get(id) ?? { count: 0, generation };
    this.admissions.delete(id);
    this.admissions.set(id, admission);
    admission.count++;
    if (generation > admission.generation) {
      admission.holderOwner = undefined;
      admission.holder = undefined;
      admission.holderVersion = undefined;
    }
    admission.generation = Math.max(admission.generation, generation);
    let closed = false;
    const current = () =>
      !closed &&
      admission.generation === generation &&
      (!holders || this.listeners.get(id) === holders) &&
      generation > (this.released.get(id) ?? -1);
    const holderOwner = {};
    let stopHolder: (() => void) | undefined;
    const send = (holder: QueueHolder) => {
      if (
        !current() ||
        admission.holderOwner !== holderOwner ||
        (admission.holder ?? null) === holder
      )
        return;
      admission.holder = holder;
      const version = (admission.holderVersion = ++this.holderVersion);
      for (const notify of this.holderListeners.get(id) ?? []) notify(generation, holder, version);
    };
    if (watchHolder && current()) {
      admission.holderOwner = holderOwner;
      stopHolder = watchHolder(send);
    }
    return {
      current,
      close: () => {
        if (closed) return;
        send(null);
        stopHolder?.();
        if (admission.holderOwner === holderOwner) admission.holderOwner = undefined;
        closed = true;
        // An HTTP-only reader holds the slot for its request, never beyond it.
        if (!--admission.count && !this.listeners.has(id)) this.discard(id);
        this.pruneReleased();
      },
    };
  }
  private pruneReleased() {
    // Keep every pinned fence plus at most capacity recent, unpinned tombstones.
    let recent = this.capacity;
    for (const id of [...this.released.keys()].reverse())
      if (!this.admissions.get(id)?.count && recent-- <= 0) this.released.delete(id);
    recent = this.capacity;
    for (const [id, admission] of [...this.admissions].reverse())
      if (!admission.count && !this.listeners.has(id) && recent-- <= 0) this.admissions.delete(id);
  }
  private pruneKeys() {
    const used = new Set<string>();
    for (const slot of this.slots.values()) {
      used.add(slot.key);
      if (slot.published) used.add(slot.published.key);
    }
    for (const [key, owner] of this.keys)
      if (!used.has(key) && !owner.flights.size) this.keys.delete(key);
  }
  release(id: string, generation: number) {
    const slot = this.slots.get(id);
    if (
      generation <
        Math.max(
          slot?.generation ?? -1,
          this.waiting.get(id)?.generation ?? -1,
          this.admissions.get(id)?.generation ?? -1,
        ) ||
      generation < (this.released.get(id) ?? -1)
    )
      return;
    this.released.delete(id);
    this.released.set(id, generation);
    this.pruneReleased();
    this.discard(id);
  }
  private discard(id: string) {
    this.waiting.delete(id);
    const admission = this.admissions.get(id);
    if (admission) admission.holder = undefined;
    const slot = this.slots.get(id);
    if (slot) {
      // The subscriber is gone: its lease goes, and the last one to go stops the read itself.
      slot.lease?.release();
      slot.lease = undefined;
      slot.published = undefined;
      slot.pending = undefined;
    }
    this.slots.delete(id);
    this.bytes -= this.retainedBytes.get(id) ?? 0;
    this.retainedBytes.delete(id);
    this.pruneKeys();
    if (slot) {
      // A capacity refusal owns no slot. Wake only its live holders, on their existing stream.
      for (const [waitingId, waiting] of [...this.waiting]) {
        if (this.slots.size >= this.capacity) break;
        this.waiting.delete(waitingId);
        // Distinct versions survive stream snapshot deduplication if this holder loses capacity again.
        this.notify(
          waitingId,
          immutable({
            ...waiting,
            version: ++this.retryVersion,
            value: null,
            state: "refresh-needed",
          }),
        );
      }
    }
  }
  /** A recipe's data type is its own; a publication leaves this door as the wire carries it, unknown. */
  async publish<I>(
    id: string,
    generation: number,
    definition: Read<I, unknown>,
    args: I,
    port: InputPort,
    keep?: (publication: Publication<unknown>) => Promise<() => void>,
    admitted = this.admission(id, generation),
  ): Promise<Publication<unknown>> {
    try {
      const normalized = definition.input.parse(args);
      const key = fingerprint([definition.name, normalized]);
      const load = definition.load;
      let slot = this.slots.get(id);
      const obsolete = (): Publication<unknown> =>
        immutable({ key, generation, version: 0, value: null, state: "superseded" });
      if (
        !admitted.current() ||
        (slot &&
          (generation < slot.generation || (generation === slot.generation && key !== slot.key)))
      )
        return obsolete();
      if (!slot) {
        if (this.slots.size >= this.capacity) {
          if (this.listeners.has(id)) this.waiting.set(id, { key, generation });
          throw new ReadBusy({
            message: "Read subscription capacity reached",
            status: 429,
            problem: "read.subscription-capacity",
          });
        }
      }
      this.waiting.delete(id);
      let owner = this.keys.get(key);
      if (!owner) {
        if (this.keys.size >= 512) throw Error("Read key capacity reached");
        owner = { version: 0, flights: new Map() };
        this.keys.set(key, owner);
      }
      if (!slot) {
        slot = { generation, key, attempt: 0 };
        this.slots.set(id, slot);
      }
      slot.generation = generation;
      slot.key = key;
      this.pruneKeys();
      const attempt = ++slot.attempt;
      const mine = () =>
        admitted.current() &&
        this.slots.get(id) === slot &&
        slot.generation === generation &&
        slot.key === key &&
        slot.attempt === attempt;
      // Share only the same admitted input set. Equal args cannot substitute another recording's inputs.
      const flightKey = fingerprint([
        key,
        generation,
        port.evaluation,
        definition.run.toString(),
        schemaId(definition.input),
        schemaId(definition.output),
      ]);
      const reuse = load?.freshBy?.[0] === "document-mark" ? port.reuse : undefined;
      const cacheKey = reuse ? fingerprint([key, reuse.target, reuse.scope]) : undefined;
      const candidate = cacheKey ? this.completed.get(cacheKey, definition) : undefined;
      const matches = (basis: readonly InputRevision[]) =>
        reuse?.current() &&
        basis.every(({ name, args, revision }) => port.revision(name, args) === revision);
      const cached =
        candidate && reuse && (await reuse.ready(candidate.nativeKeys)) && matches(candidate.basis)
          ? candidate
          : undefined;
      if (!mine()) return obsolete();
      let flight = cached ? undefined : owner.flights.get(flightKey);
      // One lease per subscriber. A retiring flight refuses the join, and the read starts again.
      let lease: ReadLease | undefined;
      try {
        lease = flight?.join();
      } catch {
        flight = undefined;
      }
      const pending = (flight && this.flightInputs.get(flight)) ?? {
        inputs: [],
        demands: new Set<ReadingDemand>(),
        basis: [],
        superseded: false,
      };
      slot.pending = pending;
      const demand = { current: () => mine() && !pending.superseded };
      pending.demands.add(demand);
      if (!flight && !cached) {
        const retries = slot.published?.value ? 0 : 2;
        const evaluation = (signal: AbortSignal) => {
          const live = {
            current: () => {
              for (const join of pending.demands) if (join.current()) return true;
              return false;
            },
          };
          const tracked: InputPort = {
            ...port,
            take: (name, args, context) => {
              if (pending.superseded) throw new RefreshNeeded("Work basis superseded");
              if (signal.aborted || !live.current()) throw Error("This read was released");
              pending.inputs.push({ name, args });
              return port.take(name, args, context, signal, live, load?.slow);
            },
          };
          // A first publication has no Value to label stale, and its refusal sends no event (below), so
          // nobody would read again: the host re-evaluates a raced read itself. A slot that retains a
          // Value keeps the labelled old Value and its publication event instead.
          // ponytail: three evaluations, no backoff; an input that outruns the read is a lasting refusal.
          const settle = async (left: number): Promise<Value<unknown>> => {
            pending.basis.length = 0;
            try {
              return await evaluate(
                definition,
                args,
                tracked,
                reuse ? (input) => pending.basis.push(input) : undefined,
              );
            } catch (error) {
              if (!(error instanceof RefreshNeeded) || !left || pending.superseded) throw error;
              return settle(left - 1);
            }
          };
          return settle(retries).then((value) => {
            const version = ++owner.version;
            return immutable({ key, generation, version, value, state: "current" as const });
          });
        };
        const made = (flight = this.open(evaluation));
        lease = made.join();
        owner.flights.set(flightKey, made);
        this.flightInputs.set(made, pending);
        void made.result
          .finally(() => {
            if (owner.flights.get(flightKey) === made) owner.flights.delete(flightKey);
            this.pruneKeys();
          })
          .catch(() => {});
      }
      // A slot that moved on (a new attempt, key or generation) releases the read it was waiting on.
      slot.lease?.release();
      slot.lease = lease;
      try {
        const result: Publication<unknown> | undefined = cached
          ? {
              key,
              generation,
              version: ++owner.version,
              value: cached.value,
              state: "current",
            }
          : await flight?.result;
        if (!mine()) return obsolete();
        if (!result?.value) throw Error("Completed read has no Value");
        const { value } = result;
        const published = immutable({ ...result, generation });
        const bytes = Buffer.byteLength(JSON.stringify(published));
        const nextBytes = this.bytes - (this.retainedBytes.get(id) ?? 0) + bytes;
        if (nextBytes > this.byteLimit)
          throw Error("Published Values exceed the shared byte bound; old Value retained");
        const dependencies = keep
          ? value.trace
              .filter((trace) => trace.outcome === "answered")
              .map((trace) => ({ trace, revision: port.revision(trace.name, trace.args) }))
          : [];
        const commit = await keep?.(published);
        if (!mine()) return obsolete();
        if (cached && !matches(cached.basis))
          throw new RefreshNeeded("The cached document basis changed", "document-mark");
        if (pending.timelineInvalidated)
          throw new RefreshNeeded(
            "Timeline receipts changed while publishing the read",
            "work-timeline",
          );
        const changed = dependencies.find(
          ({ trace, revision }) => port.revision(trace.name, trace.args) !== revision,
        );
        if (changed)
          throw new RefreshNeeded(
            "Inputs invalidated while persisting the publication",
            changed.trace.name,
          );
        const retainedBytes = this.bytes - (this.retainedBytes.get(id) ?? 0) + bytes;
        if (retainedBytes > this.byteLimit)
          throw Error("Published Values exceed the shared byte bound; old Value retained");
        this.bytes = retainedBytes;
        this.retainedBytes.set(id, bytes);
        slot.inputRaced = false;
        slot.published = published;
        const basis = cached?.basis ?? pending.basis;
        if (reuse && cacheKey && matches(basis))
          this.completed.keep(
            cacheKey,
            definition,
            value,
            basis,
            reuse.target,
            bytes,
            this.byteLimit,
          );
        this.pruneKeys();
        commit?.();
        this.notify(id);
        return this.publication(id) ?? obsolete();
      } catch (error) {
        if (!mine()) return obsolete();
        const previous = slot.published;
        const retained = previous?.value
          ? immutable({ ...previous.value, freshness: "refresh-needed" as const })
          : null;
        const result: Publication<unknown> = immutable({
          key: previous?.key ?? key,
          generation,
          version: previous?.version ?? 0,
          value: retained,
          state: "refresh-needed",
          ...(error instanceof RefreshNeeded &&
            error.input === "document-mark" && {
              refreshCause: "document-changed",
            }),
          reason: error instanceof Error ? error.message : String(error),
        });
        // Old data retains its original key/version, but its non-current label is host-owned too.
        if (previous?.value) {
          slot.inputRaced = error instanceof RefreshNeeded;
          slot.published = result;
          if (previous.state === "current") this.notify(id);
        }
        return result;
      } finally {
        pending.demands.delete(demand);
        if (slot.attempt === attempt && slot.pending === pending) slot.pending = undefined;
        lease?.release();
        if (slot.lease === lease) slot.lease = undefined;
      }
    } finally {
      admitted.close();
    }
  }
}
