import { join } from "node:path";
import { ActionJournal } from "./action-journal.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
let journal: ActionJournal | undefined;
export function hostActionJournal() {
  return (journal ??= new ActionJournal(
    join(productRoot(), "state", "host", hostOwnership.serviceName, "partition-operations.json"),
  ));
}
