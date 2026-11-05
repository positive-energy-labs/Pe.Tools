import {
  invocationOutcome,
  commands,
  workKey,
  type ActionReceipt,
  type ActionStatus,
  type WorkKey,
  type VerbDecl,
} from "@pe/agent-contracts";

import { createReadingGraph } from "./readings";
import type { WorkJournal } from "./journal";

import { createRouteTimeline } from "./timeline";
import { type MountAdapters } from "./mount-contracts";
import type { MountTarget } from "./mount-target-owner";
/** Owns Timeline receipt deduplication and provenance after an invocation leaves its Work. */
export function createMountTimeline<W>(
  adapters: Pick<MountAdapters<unknown, W>, "receiptPaths">,
  target: MountTarget<W>,
  ports: {
    dispatch(press: string): { key: WorkKey | null } | undefined;
    journal(key: WorkKey): WorkJournal;
    readings(): Pick<ReturnType<typeof createReadingGraph>, "acceptReceipt">;
    verbs(): Readonly<Record<string, VerbDecl>>;
  },
) {
  const timeline = createRouteTimeline();
  const unsettledWorks = new Map<string, WorkKey | null>();
  const sequenceReceipts = new Map<string, ActionReceipt[]>();
  const acceptReceipt = (
    receipt: ActionReceipt | ActionStatus,
    key: WorkKey | null,
    press?: string,
    invalidate = true,
  ) => {
    if (target.disposed) return;
    key = unsettledWorks.has(receipt.id)
      ? unsettledWorks.get(receipt.id)!
      : press && ports.dispatch(press)
        ? ports.dispatch(press)!.key
        : key;
    unsettledWorks.delete(receipt.id);
    const declaration = commands[receipt.key as keyof typeof commands];
    if (invalidate) ports.readings().acceptReceipt(receipt, declaration?.dirties ?? []);
    const identity = key ? workKey(key) : null;
    if (key) ports.journal(key);
    timeline.append({
      kind: "receipt",
      outcome: invocationOutcome(receipt),
      at: receipt.startedAt,
      receiptId: receipt.id,
      press: press ?? receipt.id,
      paths:
        key && "steps" in receipt && (receipt.effects.length || receipt.state === "succeeded")
          ? adapters.receiptPaths?.(receipt, key)
          : undefined,
      basis: { workKey: identity, receipt, receiptId: receipt.id },
    });
  };
  return {
    timeline,
    unsettledWorks,
    sequenceReceipts,
    acceptReceipt,
    connect(journals: Map<string, WorkJournal>) {
      return timeline.subscribe((entry) => {
        const key =
          entry.basis && typeof entry.basis === "object" && "workKey" in entry.basis
            ? entry.basis.workKey
            : null;
        if (typeof key === "string") journals.get(key)?.record(entry);
        target.notify();
      });
    },
  };
}
export type MountTimeline<W> = ReturnType<typeof createMountTimeline<W>>;
