import { join } from "node:path";
import { ActionJournal } from "./action-journal.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import type { LegacyRouteStateSource } from "@pe/runtime";
let source: (() => Promise<LegacyRouteStateSource>) | undefined;
export function bindLegacyRouteSource(read: () => Promise<LegacyRouteStateSource>) {
  source = read;
}
let journal: ActionJournal | undefined;
export function hostActionJournal() {
  return (journal ??= new ActionJournal(
    join(productRoot(), "state", "host", hostOwnership.serviceName, "partition-operations.json"),
    () => {
      if (!source) throw Error("Legacy route census is unavailable; external admission is closed");
      return source();
    },
  ));
}
