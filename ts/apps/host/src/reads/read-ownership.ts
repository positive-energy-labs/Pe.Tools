import type { OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import type {
  CausalOwnership,
  CausalTerminalState,
  NativeAnswer,
  RequestIdentityData,
} from "@pe/host-internal/request-contracts";
import type { CatalogReadKey } from "./door.ts";

// Contract only: no implementation yet. These link the lifetimes of reads that NativeReads acquires;
// they add no second durable identity, journal or dispatcher.

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
