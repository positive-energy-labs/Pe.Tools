import type { OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import type {
  CausalOwnership,
  CausalTerminalState,
  NativeAnswer,
  RequestIdentityData,
} from "@pe/host-internal/request-contracts";
import type { CatalogReadKey } from "./door.ts";

// These link NativeReads lifetimes; they add no durable identity, journal or dispatcher.

/** Idempotent. The final release signals the read only; it never detaches a write or a restoration. */
export interface ReadLease {
  release(): void;
}
export interface ReadFlight<T> {
  readonly result: Promise<T>;
  /** Refuses a retiring flight. Each consumer is admitted before it joins. */
  join(): ReadLease;
  readonly settlement: Promise<CausalTerminalState>;
}
export interface ReadOwner {
  /** The existing validated owner; never minted from request JSON. */
  readonly ownership: CausalOwnership;
  /** Supplies no caller, target or causal parent: construction captured the admitted target and session. */
  // The evidence parameter (`OpEvidenceOf<K>`) joins when `NativeAnswer` takes it (CONTRACTS.md, native 6).
  native<K extends CatalogReadKey>(
    key: K,
    input: OpRequestOf<K>,
  ): Promise<NativeAnswer<OpResponseOf<K>>>;
  /** Signal acknowledgement only, never terminal proof. Stops new ordinary reads and detaches read leases. */
  requestStop(): Promise<void>;
  state(): CausalTerminalState;
  /** Waits for owned required descendants and cleanup. Unknown evidence returns an unsettled state. */
  settle(): Promise<CausalTerminalState>;
}
export interface ReadOwnership {
  open(identity: RequestIdentityData): ReadOwner;
  flight<T>(owner: ReadOwner, run: (signal: AbortSignal) => Promise<T>): ReadFlight<T>;
}

/** The native port performs admission with the captured identity before joining NativeReads.
 * State and settlement remain with the existing descendant/cleanup owner, outside the read signal.
 */
export interface ReadOwnershipPorts {
  native<K extends CatalogReadKey>(
    identity: RequestIdentityData,
    key: K,
    input: OpRequestOf<K>,
    signal: AbortSignal,
  ): Promise<NativeAnswer<OpResponseOf<K>>>;
  state(identity: RequestIdentityData): CausalTerminalState;
  settle(identity: RequestIdentityData): Promise<CausalTerminalState>;
}

const stopped = () => new Error("Read owner is stopped or settling");
/** What a subscriber needs of a flight: its result and a lease on it. */
export type Flight<T> = Pick<ReadFlight<T>, "result" | "join">;
/**
 * A flight with no causal owner: the lease count and the read's own signal, nothing else.
 * `ReadOwnership.flight` adds the owner's admission, settlement and Stop on top of this one.
 * `admits` closes the flight to new consumers (an owner that stopped or is settling).
 */
export function startFlight<T>(
  run: (signal: AbortSignal) => Promise<T>,
  admits: () => boolean = () => true,
): Flight<T> {
  const controller = new AbortController();
  let retiring = false,
    terminal = false,
    consumers = 0;
  // Defer execution so a synchronous throw follows the same settlement path as a rejection.
  const result = Promise.resolve().then(() => run(controller.signal));
  const finish = () => void (terminal = true);
  result.then(finish, finish);
  return {
    result,
    join() {
      if (retiring || terminal || !admits()) throw stopped();
      consumers++;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          if (--consumers !== 0 || terminal) return;
          retiring = true;
          // This signal belongs only to the read. Submitted writes and required cleanup
          // retain their existing owner; never route this through parent Stop.
          controller.abort();
        },
      };
    },
  };
}

export function createReadOwnership(ports: ReadOwnershipPorts): ReadOwnership {
  const owners = new WeakMap<
    ReadOwner,
    {
      identity: RequestIdentityData;
      closed: boolean;
      leases: Set<ReadLease>;
      pending: Set<Promise<unknown>>;
    }
  >();
  const ownership: ReadOwnership = {
    open(identity) {
      const entry = {
        identity,
        closed: false,
        leases: new Set<ReadLease>(),
        pending: new Set<Promise<unknown>>(),
      };
      const owner: ReadOwner = {
        ownership: identity.ownership,
        async native(key, input) {
          const flight = ownership.flight(owner, (signal) =>
            ports.native(identity, key, input, signal),
          );
          const lease = flight.join();
          try {
            return await flight.result;
          } finally {
            lease.release();
          }
        },
        async requestStop() {
          entry.closed = true;
          for (const lease of [...entry.leases]) lease.release();
        },
        state() {
          const state = ports.state(identity);
          return entry.pending.size && state.kind === "settled"
            ? { kind: "unsettled", requiredDescendants: [], evidence: state.evidence }
            : state;
        },
        async settle() {
          // Close admission without aborting required reads or restoration/terminal observation.
          entry.closed = true;
          await Promise.allSettled([...entry.pending]);
          return ports.settle(identity);
        },
      };
      owners.set(owner, entry);
      return owner;
    },
    flight(owner, run) {
      const entry = owners.get(owner);
      if (!entry) throw new Error("Read owner belongs to another lifetime service");
      if (entry.closed) throw stopped();
      const core = startFlight(run, () => !entry.closed);
      const leases = new Set<ReadLease>();
      entry.pending.add(core.result);
      const finish = () => {
        entry.pending.delete(core.result);
        for (const lease of leases) entry.leases.delete(lease);
        leases.clear();
      };
      const completed = core.result.then(finish, finish);
      let settlement: Promise<CausalTerminalState> | undefined;
      return {
        result: core.result,
        get settlement() {
          return (settlement ??= completed.then(() => ports.settle(entry.identity)));
        },
        join() {
          const held = core.join();
          // The owner tracks the lease so `requestStop` can detach it; the count is the flight's.
          const lease: ReadLease = {
            release() {
              leases.delete(lease);
              entry.leases.delete(lease);
              held.release();
            },
          };
          entry.leases.add(lease);
          leases.add(lease);
          return lease;
        },
      };
    },
  };
  return ownership;
}
