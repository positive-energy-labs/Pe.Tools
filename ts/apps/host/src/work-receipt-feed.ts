import { DEFAULT_WORK_HISTORY_LIMITS } from "@pe/runtime";
// The WeakMap feed registry is ambient module state; phase 5 D re-homes it as a scoped subscription service.
import {
  canonicalRouteInput,
  receiptsForWork,
  workKey,
  type ActionReceipt,
  type Receipt,
} from "@pe/agent-contracts";
import type {
  ReceiptFeedState,
  ReceiptCursor,
  WorkScope,
} from "../../../packages/agent-contracts/src/work-journal-door.ts";
import type { ActionJournal } from "./action-journal.ts";

type Journal = Pick<ActionJournal, "read" | "subscribe">;
type Feed = { subscribe(emit: (state: ReceiptFeedState) => void): () => void };
const feeds = new WeakMap<Journal, Map<string, Feed>>();
/** Host adapter over the existing action subscription. Subscribe before snapshot acquisition. */
export function observeWorkReceipts(
  journal: Journal,
  scope: Pick<WorkScope, "key" | "target">,
  emit: (state: ReceiptFeedState) => void,
  limits: { maxCount: number; maxBytes: number } = DEFAULT_WORK_HISTORY_LIMITS,
): () => void {
  const identity = canonicalRouteInput([workKey(scope.key), scope.target]);
  const registry = feeds.get(journal) ?? new Map<string, Feed>();
  feeds.set(journal, registry);
  const existing = registry.get(identity);
  if (existing) return existing.subscribe(emit);
  const consumers = new Set<(state: ReceiptFeedState) => void>();
  const publish = (state: ReceiptFeedState) => consumers.forEach((listener) => listener(state));
  let closed = false;
  let acquiring = true;
  let failure: Extract<ReceiptFeedState, { kind: "failed" }> | undefined;
  let through = 0;
  let from = 0;
  const rows = new Map<
    string,
    { cursor: number; revision: number; receipt: ActionReceipt; bytes: number }
  >();
  const encoder = new TextEncoder();
  let totalBytes = 2; // JSON array brackets; each additional row also contributes a comma.
  const removeRow = (id: string) => {
    const previous = rows.get(id);
    if (!previous) return;
    totalBytes -= previous.bytes + (rows.size > 1 ? 1 : 0);
    rows.delete(id);
  };
  const pending: Receipt[] = [];
  // A bounded duplicate window also covers terminal rows already trimmed from ready.
  const versions = new Map<string, number>();
  const matches = (row: ActionReceipt) =>
    canonicalRouteInput(row.target.kind === "host" ? null : row.target) ===
      canonicalRouteInput(scope.target) || receiptsForWork([row], scope.key).length > 0;
  const ingest = (value: Receipt) => {
    if (value.body.kind !== "action" || !matches(value.body.value)) return;
    const receipt = value.body.value;
    if ((versions.get(receipt.id) ?? rows.get(receipt.id)?.revision ?? -1) >= value.revision)
      return;
    versions.delete(receipt.id);
    versions.set(receipt.id, value.revision);
    while (versions.size > Math.max(256, limits.maxCount))
      versions.delete(versions.keys().next().value!);
    through++;
    removeRow(receipt.id);
    const bytes = encoder.encode(JSON.stringify(receipt)).byteLength;
    totalBytes += bytes + (rows.size ? 1 : 0);
    rows.set(receipt.id, { cursor: through, revision: value.revision, receipt, bytes });
    // Non-terminal rows survive both bounds, even if they alone exceed the budget.
    for (const [id, row] of rows) {
      if (rows.size <= limits.maxCount && totalBytes <= limits.maxBytes) break;
      if (["waiting", "running", "unknown"].includes(row.receipt.state)) continue;
      removeRow(id);
      from = Math.max(from, row.cursor + 1);
    }
    if (!acquiring) publish({ kind: "receipt", cursor: through as ReceiptCursor, receipt });
  };
  const stop = journal.subscribe({ kinds: ["action"] }, (row) => {
    if (closed) return;
    if (acquiring) pending.push(row);
    else ingest(row);
  });
  const ready = (): ReceiptFeedState => ({
    kind: "ready",
    receipts: {
      rows: [...rows.values()].map((row) => row.receipt),
      from: from as ReceiptCursor,
      through: through as ReceiptCursor,
    },
  });
  const feed: Feed = {
    subscribe(listener) {
      consumers.add(listener);
      listener(failure ?? (acquiring ? { kind: "pending" } : ready()));
      return () => {
        consumers.delete(listener);
        if (!consumers.size) {
          if (!closed) {
            closed = true;
            stop();
          }
          if (registry.get(identity) === feed) registry.delete(identity);
        }
      };
    },
  };
  registry.set(identity, feed);
  const release = feed.subscribe(emit);
  // ponytail: One all-receipt scan per feed open; phase 5 C upgrades to indexed terminal reads.
  void journal.read({ kinds: ["action"] }).then(
    (initial) => {
      if (closed) return;
      for (const row of [...initial, ...pending]) ingest(row);
      acquiring = false;
      publish(ready());
    },
    (error: unknown) => {
      if (closed) return;
      failure = {
        kind: "failed",
        failure: { kind: "failed", code: "ReceiptFeedFailed", message: String(error) },
      };
      closed = true;
      // Retire before publishing so even a reentrant subscriber acquires a fresh feed.
      registry.delete(identity);
      stop();
      publish(failure);
    },
  );
  return release;
}
