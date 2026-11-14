import { Effect } from "effect";
import type { ActionJournal } from "./action-journal.ts";
import type { RevitBridge } from "./bridge.ts";
import { onRevoke, onPagePinRevoke } from "./control.ts";
import type { DocumentRef } from "@pe/agent-contracts";

/** Removing a human-added target retires work queued under it; dispatched work keeps its result. */
export function bindRevoke(owner: ActionJournal, bridge: RevitBridge["Service"]) {
  let active = true;
  const sweep = (ownerKey: string, lifetime?: DocumentRef) => {
    const requests = owner.list().then((rows) =>
      active
        ? rows.flatMap((row) => {
            const basis = row.basis;
            const matches = lifetime
              ? basis?.kind === "grant" &&
                basis.thread === ownerKey &&
                basis.lifetime.session === lifetime.session &&
                basis.lifetime.openId === lifetime.openId
              : basis?.kind === "person-pin" && basis.page === ownerKey;
            if (row.state !== "running" || !matches) return [];
            return row.steps
              .filter((step) => step.kind === "native" && step.state === "running")
              .map((step) => step.id);
          })
        : [],
    );
    void bridge.cancelQueued(requests).catch((error) =>
      // effect-edge: island, phase 5
      Effect.runSync(Effect.logError("Target removal queue sweep failed", error)),
    );
  };
  const unbind = onRevoke(sweep);
  const unbindPage = onPagePinRevoke((page) => sweep(page));
  return () => {
    active = false;
    unbind();
    unbindPage();
  };
}
