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
  const stopped = () => new Error("Read owner is stopped or settling");
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
      const controller = new AbortController();
      const leases = new Set<ReadLease>();
      let retiring = false,
        terminal = false,
        consumers = 0;
      // Defer execution so a synchronous throw follows the same settlement path as a rejection.
      const result = Promise.resolve().then(() => run(controller.signal));
      entry.pending.add(result);
      const finish = () => {
        terminal = true;
        entry.pending.delete(result);
        for (const lease of leases) entry.leases.delete(lease);
        leases.clear();
      };
      const completed = result.then(finish, finish);
      let settlement: Promise<CausalTerminalState> | undefined;
      return {
        result,
        get settlement() {
          return (settlement ??= completed.then(() => ports.settle(entry.identity)));
        },
        join() {
          if (retiring || terminal || entry.closed) throw stopped();
          consumers++;
          let released = false;
          const lease: ReadLease = {
            release() {
              if (released) return;
              released = true;
              leases.delete(lease);
              entry.leases.delete(lease);
              if (--consumers !== 0 || terminal) return;
              retiring = true;
              // This signal belongs only to the read. Submitted writes and required cleanup
              // retain their existing owner; never route this through parent Stop.
              controller.abort();
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
