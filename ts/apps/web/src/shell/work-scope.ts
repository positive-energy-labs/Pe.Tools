import type { ExecutionTarget, WorkKey, WorkHandle } from "@pe/agent-contracts";
export interface MountScope<W> {
  /** Resolved before hydration, so first Work delivery does not reacquire document readings. */
  workKey?: WorkKey;
  failure?: string | null;
  closed?: boolean;
  target: ExecutionTarget;
  work: { handle: WorkHandle; doc: W } | null;
  /** The mount sets this: a write was refused as stale and nothing newer has been read or accepted since. */
  conflict?: boolean;
  /** The kernel door sets this: the host holds Work it cannot read, so start-fresh is the one way out. */
  unreadable?: WorkKey;
  /** The kernel door sets this: what the host set aside for this Work, raw; the owner derives the patches with the readings. */
  salvaged?: unknown;
}
