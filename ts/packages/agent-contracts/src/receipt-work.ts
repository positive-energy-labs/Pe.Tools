import { workKeySchema, workKey, type WorkKey } from "./route-state.ts";
import { sameAddress } from "./target.ts";
import type { RetainedWorkKey } from "./receipt-evidence.ts";

/** Read association only. Address provenance is not identity; old open refs grant no authority. */
export function sameReceiptWork(original: RetainedWorkKey, current: WorkKey): boolean {
  if (original.binding === "address" && current.binding === "address")
    return original.route === current.route && sameAddress(original.target, current.target);
  const fresh = workKeySchema.safeParse(original);
  return fresh.success && workKey(fresh.data) === workKey(current);
}
