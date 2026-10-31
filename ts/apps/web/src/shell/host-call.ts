import type { OpKey, OpCallArgs, OpResponseOf } from "@pe/host-contracts/operation-types";

/** A call bound to a resolved ExecutionTarget. */
export type HostCaller = <K extends OpKey>(
  operation: K,
  ...args: OpCallArgs<K, never>
) => Promise<OpResponseOf<K>>;
