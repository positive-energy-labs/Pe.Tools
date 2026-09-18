/**
 * Takeoffs inside the workbench. The pane is the route: `useTakeoffsController` owns the same manifest
 * the standalone route mounts, so there is no second store, no second registry and no second
 * source switch. `?work=` on the route is `capture` here, and the saved list is the thread
 * document's, read from that one controller's resolved Work.
 */
import { useState } from "react";

import { TakeoffsControllerOwner } from "#/takeoff/route";
import { useTakeoffsController } from "#/takeoff/controller";
import { TakeoffsPage } from "#/takeoff/route-workspace";
import { SavedTakeoffsView } from "#/takeoff/saved-review";
import { ActionButton } from "#/components/lang/action-button";

export function TakeoffsPane({ thread }: { thread?: string }) {
  const store = useTakeoffsController(thread ? { thread } : {});
  // Embedded-pane navigation; closing the pane intentionally returns to its live route.
  const [capture, setCapture] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  if (saved)
    return (
      <SavedTakeoffsView
        capture={capture}
        document={store.handle.work.key.target}
        select={(patch) => {
          setCapture(patch.work);
          if (patch.work === undefined && capture === undefined) setSaved(false);
        }}
        renderCapture={(row) => <TakeoffsControllerOwner key={row.id} savedCapture={row} />}
      />
    );
  return (
    <>
      <ActionButton
        label="saved review"
        reason="Read dated captures without Revit"
        onClick={() => setSaved(true)}
      />
      <TakeoffsPage store={store} />
    </>
  );
}
