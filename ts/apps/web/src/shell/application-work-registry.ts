import { workKey, type WorkKey, type ActionReceipt } from "@pe/agent-contracts";
import { createWorkJournal } from "../../../../packages/runtime/src/work-journal";
import type {
  WorkJournalDoor,
  WorkScope,
  ReceiptCursor,
  WorkFeedState,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { freezePage } from "./page-port";

export interface RefusedWorkEdit {
  readonly input: import("@pe/agent-contracts").WorkWrite;
  readonly basis: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
  readonly refusal: import("../../../../packages/agent-contracts/src/work-journal-door").WorkWriteRefusal;
}

/** Reconstructible application projection. Last Place release removes the entry, never native execution. */
export function createApplicationWorkRegistry() {
  const entries = new Map<string, ReturnType<typeof createEntry>>();
  function createEntry(key: WorkKey) {
    const journal = createWorkJournal(key);
    const rows = new Map<string, { cursor: ReceiptCursor; receipt: ActionReceipt }>();
    const listeners = new Set<() => void>();
    let receiptWindow: { kind: string; from: number; through: number } = {
      kind: "pending",
      from: 0,
      through: 0,
    };
    let refs = 0;
    let stop: (() => void) | undefined;
    const notify = () => listeners.forEach((listener) => listener());
    const record = (receipt: ActionReceipt) => {
      const paths = receipt.consumes.flatMap((item) =>
        item.kind === "work" && workKey(item.probe.handle.key) === workKey(key)
          ? item.probe.paths
          : [],
      );
      journal.record({
        kind: "receipt",
        at: receipt.startedAt,
        receiptId: receipt.id,
        paths,
        outcome: receipt.outcome,
        basis: { receipt },
      });
    };
    const entry = {
      journal,
      refusedEdits: new Map<string, RefusedWorkEdit>(),
      acquire() {
        refs++;
      },
      release() {
        if (--refs === 0) {
          stop?.();
          listeners.clear();
          entries.delete(workKey(key));
        }
      },
      connect(scope: WorkScope, door: Pick<WorkJournalDoor, "receipts">) {
        if (stop || !door.receipts) return;
        // Install the sentinel before subscribing: in-memory doors may deliver synchronously.
        stop = () => {};
        stop = door.receipts(scope).subscribe((state) => {
          receiptWindow = { ...receiptWindow, kind: state.kind };
          if (state.kind === "pending" || state.kind === "gap" || state.kind === "failed") {
            notify();
            return;
          }
          if (state.kind === "ready") {
            receiptWindow = {
              kind: "ready",
              from: state.receipts.from,
              through: state.receipts.through,
            };
            rows.clear();
            for (const receipt of state.receipts.rows)
              rows.set(receipt.id, { cursor: state.receipts.through, receipt });
          } else if (state.kind === "receipt") {
            if ((rows.get(state.receipt.id)?.cursor ?? -1) >= state.cursor) return;
            rows.set(state.receipt.id, { cursor: state.cursor, receipt: state.receipt });
            receiptWindow.through = state.cursor;
          } else return;
          for (const { receipt } of rows.values()) record(receipt);
          notify();
        }, notify);
      },
      restore(state: Extract<WorkFeedState, { kind: "ready" }>) {
        journal.restoreView(
          { revision: state.snapshot.revision, doc: state.snapshot.value },
          state.history,
        );
        for (const { receipt } of rows.values()) record(receipt);
        notify();
      },
      receiptWindow: () => Object.freeze({ ...receiptWindow }),
      timeline: () =>
        freezePage(
          [
            ...journal.read().moves.map((move) => ({
              kind: "checkpoint" as const,
              at: move.at,
              press: move.press,
              verb: move.kind,
              basis: move,
            })),
            ...[...rows.values()].map(({ receipt }) => ({
              kind: "receipt" as const,
              at: receipt.startedAt,
              receiptId: receipt.id,
              verb: receipt.key,
              basis: { receipt },
              outcome: receipt.outcome,
            })),
          ].sort((a, b) => Number(new Date(a.at)) - Number(new Date(b.at))),
        ),
      activity: (): ReadonlyArray<Readonly<ActionReceipt>> =>
        freezePage([...rows.values()].map(({ receipt }) => receipt)),
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    return entry;
  }
  return {
    acquire(key: WorkKey) {
      const id = workKey(key);
      let entry = entries.get(id);
      if (!entry) {
        entry = createEntry(key);
        entries.set(id, entry);
      }
      entry.acquire();
      let released = false;
      return {
        entry,
        release() {
          if (!released) {
            released = true;
            entry.release();
          }
        },
      };
    },
    size: () => entries.size,
  };
}
export const applicationWorkRegistry = createApplicationWorkRegistry();
