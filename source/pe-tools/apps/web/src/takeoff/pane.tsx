/**
 * Takeoffs inside the workbench. The pane is the route: `useTakeoffStore` owns the same manifest
 * the standalone route mounts, so there is no second store, no second registry and no second
 * source switch. `?work=` on the route is `capture` here.
 */
import { useState } from "react";
import type { WorkKey } from "@pe/agent-contracts";

import { TakeoffsStoreOwner } from "#/takeoff/route";
import { SavedTakeoffsView } from "#/takeoff/saved-review";
import { ActionButton } from "#/components/lang/action-button";

export function TakeoffsPane({ scope }: { scope: WorkKey }) {
  const [capture, setCapture] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  if (saved)
    return (
      <SavedTakeoffsView
        capture={capture}
        {...(scope.target ? { document: scope.target } : {})}
        select={(patch) => {
          setCapture(patch.work);
          if (patch.work === undefined && capture === undefined) setSaved(false);
        }}
        renderCapture={(row) => <TakeoffsStoreOwner key={row.id} savedCapture={row} />}
      />
    );
  return (
    <>
      <ActionButton
        label="saved review"
        reason="Read dated captures without Revit"
        onClick={() => setSaved(true)}
      />
      <TakeoffsStoreOwner target={scope.target ?? ""} />
    </>
  );
}
