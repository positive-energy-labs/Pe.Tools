import type { ExecutionTarget } from "@pe/agent-contracts";
import { isAnyOperationKey, type OpRequestOf } from "@pe/host-contracts/operation-types";
import type { HostCaller } from "#/shell/host-call";
import { isMutation, type HostOperationCatalogEntry } from "./manifest";

/** Read-only catalog execution. Raw mutations cannot bypass the kernel's admission door. */
export async function runOp(input: {
  op: HostOperationCatalogEntry;
  request: unknown;
  target: ExecutionTarget;
  call: HostCaller;
}) {
  const started = performance.now();
  const key = input.op.key;
  if (!isAnyOperationKey(key))
    throw Error(`Operation ${key} is absent from this client's contract; regenerate the catalog.`);
  if (isMutation(input.op)) throw Error("Mutations require action admission");
  if (input.op.intent?.toLowerCase() !== "read")
    throw Error("Operation readiness metadata is unavailable");
  return {
    kind: "value" as const,
    value: await input.call(key, input.request as OpRequestOf<typeof key>),
    elapsedMs: Math.round(performance.now() - started),
  };
}
