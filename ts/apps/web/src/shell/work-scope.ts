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
}
