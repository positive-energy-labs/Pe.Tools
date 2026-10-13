import { join } from "node:path";
import { ActionJournal } from "./action-journal.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { receiptStampSchema, type ReceiptStamp } from "@pe/agent-contracts";
let journal: ActionJournal | undefined;
let stamp: ReceiptStamp | null = null;
/** Called by host boot only after its runtime identity has been admitted. */
export function setHostReceiptStamp(value: ReceiptStamp) {
  const next = receiptStampSchema.parse(value);
  if (next.component !== "host") throw Error("The host receipt owner requires a host stamp");
  if (stamp && JSON.stringify(stamp) !== JSON.stringify(next))
    throw Error("Host receipt identity is immutable");
  stamp = next;
  hostActionJournal();
}
export function hostActionJournal() {
  return (journal ??= new ActionJournal(
    join(productRoot(), "state", "host", hostOwnership.serviceName, "partition-operations.json"),
    () => stamp,
  ));
}

export const recordBridgeQueue = (...args: Parameters<ActionJournal["recordQueue"]>) =>
  journal
    ? journal.recordQueue(...args)
    : Promise.reject(Error("Receipt owner has not been initialized"));
