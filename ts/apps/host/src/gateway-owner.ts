import { join } from "node:path";
import { ActionJournal } from "./action-journal.ts";
import { HostLog } from "./host-log.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { receiptStampSchema, type ReceiptStamp } from "@pe/agent-contracts";
let journal: ActionJournal | undefined;
let log: HostLog | undefined;
let stamp: ReceiptStamp | null = null;
const stateDir = () => join(productRoot(), "state", "host", hostOwnership.serviceName);
/** Called by host boot only after its runtime identity has been admitted. */
export function setHostReceiptStamp(value: ReceiptStamp) {
  const next = receiptStampSchema.parse(value);
  if (next.component !== "host") throw Error("The host receipt owner requires a host stamp");
  if (stamp && JSON.stringify(stamp) !== JSON.stringify(next))
    throw Error("Host receipt identity is immutable");
  stamp = next;
  hostActionJournal();
}
/** The one host log (`@pe/agent-contracts` `host-log.ts`). */
export function hostLog() {
  return (log ??= new HostLog(join(stateDir(), "log")));
}
/** Every committed receipt revision is appended to the host log, in commit order. */
const logReceipts = (receipts: ActionJournal, into: HostLog) =>
  receipts.subscribe({}, (receipt) => into.append({ kind: "receipt", receipt }));
export function hostActionJournal() {
  if (journal) return journal;
  journal = new ActionJournal(join(stateDir(), "partition-operations.json"), () => stamp);
  logReceipts(journal, hostLog());
  return journal;
}

export const recordBridgeQueue = (...args: Parameters<ActionJournal["recordQueue"]>) =>
  journal
    ? journal.recordQueue(...args)
    : Promise.reject(Error("Receipt owner has not been initialized"));

export const bridgeDispatchRefusal = (requestId: string): string | null =>
  journal?.dispatchRefusal(requestId) ?? null;
