import { Effect } from "effect";
import type { ActionJournal } from "./action-journal.ts";
import type { RevitBridge } from "./bridge.ts";
import { onRevoke } from "./control.ts";

/** Revoke retires queued work for this grant; dispatched work keeps its result. */
export function bindRevoke(owner: ActionJournal, bridge: RevitBridge["Service"]) {
  let active = true;
  const unbind = onRevoke((thread, grant) => {
    const requests = owner.list().then((rows) =>
      active
        ? rows.flatMap((row) => {
            const basis = row.basis;
            if (
              row.state !== "running" ||
              basis?.kind !== "grant" ||
              basis.thread !== thread ||
              basis.lifetime.session !== grant.lifetime.session ||
              basis.lifetime.openId !== grant.lifetime.openId
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
      .catch((error) => Effect.runSync(Effect.logError("Grant revoke queue sweep failed", error)));
  });
  return () => {
    active = false;
    unbind();
  };
}
