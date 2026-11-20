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
  type Read,
  type Trace,
  type Value,
} from "@pe/host-internal/reads/evaluator";
import { startFlight, type Flight, type ReadLease } from "./read-ownership.ts";
import { ReadBusy } from "@pe/host-internal/read-errors";

export interface Publication<T> {
  readonly key: string;
  readonly generation: number;
  readonly version: number;
  readonly value: Value<T> | null;
  readonly state: "current" | "refresh-needed" | "superseded";
  readonly reason?: string;
}
type Dependency = Pick<Trace, "name" | "args">;
type Pending = { inputs: Dependency[]; superseded: boolean };
type Slot = {
  generation: number;
  key: string;
  published?: Publication<unknown>;
  inputRaced?: boolean;
  attempt: number;
  pending?: Pending;
  lease?: ReadLease;
};
/** How a publication starts its shared read. Pass `(run) => ownership.flight(owner, run)` to bind it to a `ReadOwner`. */
export type StartFlight = <T>(run: (signal: AbortSignal) => Promise<T>) => Flight<T>;
/** One entry per (read,args), one generation per client subscription; no client acknowledgement. */
export class Publications {
  private readonly slots = new Map<string, Slot>();
  private readonly waiting = new Map<string, Pick<Publication<unknown>, "key" | "generation">>();
  private retryVersion = 0;
  private readonly released = new Map<string, number>();
  private readonly admissions = new Map<string, number>();
  private readonly retainedBytes = new Map<string, number>();
  private bytes = 0;
  private readonly keys = new Map<
    string,
    { version: number; flights: Map<string, Flight<Publication<unknown>>> }
  >();
  private readonly listeners = new Map<string, Set<(retry?: Publication<unknown>) => void>>();
  private readonly flightInputs = new WeakMap<Flight<Publication<unknown>>, Pending>();
  constructor(
    private readonly capacity = 128,
    private readonly byteLimit = 128 * 1024 * 1024,
    private readonly open: StartFlight = startFlight,
  ) {}
  observe(id: string, notify: (publication: Publication<unknown>) => void) {
    const listeners = this.listeners.get(id) ?? new Set<(retry?: Publication<unknown>) => void>();
    const listener = (retry?: Publication<unknown>) => {
      const value = retry ?? this.slots.get(id)?.published;
      if (value) notify(value);
    };
    listeners.add(listener);
    this.listeners.set(id, listeners);
    listener();
    return () => {
      listeners.delete(listener);
      if (!listeners.size && this.listeners.get(id) === listeners) {
        this.listeners.delete(id);
        this.discard(id);
      }
    };
  }
  private notify(id: string, retry?: Publication<unknown>) {
    const listeners = this.listeners.get(id);
    for (const listener of listeners ?? []) {
      try {
        listener(retry);
      } catch {
        listeners?.delete(listener);
      }
    }
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
    const slots =
      subscription === undefined
        ? this.slots
        : [[subscription, this.slots.get(subscription)] as const];
    for (const [id, slot] of slots) {
      if (!slot) continue;
      const previous = slot.published;
      const pending = slot.pending?.inputs.some((input) => input.name === "work" && matches(input));
      if (pending || previous?.value?.trace.some(matches)) {
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
          value: previous?.value ? { ...previous.value, freshness: "refresh-needed" } : null,
        });
        this.notify(id);
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
  admission(id: string, generation: number) {
    const holders = this.listeners.get(id);
    this.admissions.set(id, (this.admissions.get(id) ?? 0) + 1);
    const allowed = generation > (this.released.get(id) ?? -1);
    let closed = false;
    return {
      current: () =>
        !closed &&
        allowed &&
        (!holders || this.listeners.get(id) === holders) &&
        generation > (this.released.get(id) ?? -1),
      close: () => {
        if (closed) return;
        closed = true;
        const remaining = this.admissions.get(id)! - 1;
        if (remaining) this.admissions.set(id, remaining);
        else this.admissions.delete(id);
        // An HTTP-only reader holds the slot for its request, never beyond it.
        if (!remaining && !this.listeners.has(id)) this.discard(id);
        this.pruneReleased();
      },
    };
  }
  private pruneReleased() {
    // Keep every pinned fence plus at most capacity recent, unpinned tombstones.
    let recent = this.capacity;
    for (const id of [...this.released.keys()].reverse())
      if (!this.admissions.has(id) && recent-- <= 0) this.released.delete(id);
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
      generation < Math.max(slot?.generation ?? -1, this.waiting.get(id)?.generation ?? -1) ||
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
      const key = fingerprint([definition.name, definition.input.parse(args)]);
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
      let flight = owner.flights.get(flightKey);
      // One lease per subscriber. A retiring flight refuses the join, and the read starts again.
      let lease: ReadLease | undefined;
      try {
        lease = flight?.join();
      } catch {
        flight = undefined;
      }
      const pending = (flight && this.flightInputs.get(flight)) ?? {
        inputs: [],
        superseded: false,
      };
      slot.pending = pending;
      if (!flight) {
        const evaluation = (signal: AbortSignal) => {
          const tracked: InputPort = {
            ...port,
            take: (name, args, context) => {
              if (signal.aborted) throw Error("This read was released");
              if (pending.superseded) throw new RefreshNeeded("Work basis superseded");
              pending.inputs.push({ name, args });
              return port.take(name, args, context, signal);
            },
          };
          // A first publication has no Value to label stale, and its refusal sends no event (below), so
          // nobody would read again: the host re-evaluates a raced read itself. A slot that retains a
          // Value keeps the labelled old Value and its publication event instead.
          // ponytail: three evaluations, no backoff; an input that outruns the read is a lasting refusal.
          const settle = async (left: number): Promise<Value<unknown>> => {
            try {
              return await evaluate(definition, args, tracked);
            } catch (error) {
              if (!(error instanceof RefreshNeeded) || !left || pending.superseded) throw error;
              return settle(left - 1);
            }
          };
          return settle(slot!.published?.value ? 0 : 2).then((value) => {
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
        const result = await flight.result;
        if (!mine()) return obsolete();
        const published = immutable({ ...result, generation });
        const bytes = Buffer.byteLength(JSON.stringify(published));
        const nextBytes = this.bytes - (this.retainedBytes.get(id) ?? 0) + bytes;
        if (nextBytes > this.byteLimit)
          throw Error("Published Values exceed the shared byte bound; old Value retained");
        const dependencies = keep
          ? published
              .value!.trace.filter((trace) => trace.outcome === "answered")
              .map((trace) => ({ trace, revision: port.revision(trace.name, trace.args) }))
          : [];
        const commit = await keep?.(published);
        if (!mine()) return obsolete();
        if (
          dependencies.some(
            ({ trace, revision }) => port.revision(trace.name, trace.args) !== revision,
          )
        )
          throw new RefreshNeeded("Inputs invalidated while persisting the publication");
        const retainedBytes = this.bytes - (this.retainedBytes.get(id) ?? 0) + bytes;
        if (retainedBytes > this.byteLimit)
          throw Error("Published Values exceed the shared byte bound; old Value retained");
        this.bytes = retainedBytes;
        this.retainedBytes.set(id, bytes);
        slot.inputRaced = false;
        slot.published = published;
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
        if (slot.pending === pending) slot.pending = undefined;
        lease?.release();
        if (slot.lease === lease) slot.lease = undefined;
      }
    } finally {
      admitted.close();
    }
  }
}
