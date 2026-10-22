import { Effect } from "effect";
import type { ActionJournal } from "./action-journal.ts";
import type { RevitBridge } from "./bridge.ts";
import { onRevoke } from "./control.ts";

/** Removing a human-added target retires work queued under it; dispatched work keeps its result. */
export function bindRevoke(owner: ActionJournal, bridge: RevitBridge["Service"]) {
  let active = true;
  const unbind = onRevoke((thread, lifetime) => {
    const requests = owner.list().then((rows) =>
      active
        ? rows.flatMap((row) => {
            const basis = row.basis;
            if (
              row.state !== "running" ||
              basis?.kind !== "grant" ||
              basis.thread !== thread ||
              basis.lifetime.session !== lifetime.session ||
              basis.lifetime.openId !== lifetime.openId
            )
              return [];
            return row.steps
              .filter((step) => step.kind === "native" && step.state === "running")
              .map((step) => step.id);
          })
        : [],
    );
    void bridge
      .cancelQueued(requests)
      .catch((error) =>
        Effect.runSync(Effect.logError("Target removal queue sweep failed", error)),
      );
  });
  return () => {
    active = false;
    unbind();
  };
}
