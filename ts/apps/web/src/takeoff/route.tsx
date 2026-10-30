/**
 * Standalone /takeoffs uses the graph export below. These component exports still serve hosted
 * tools and chat; TODO: remove their old owner when the kernel admits target/thread mounts.
 */
import { useEffect, useState } from "react";
import type { TakeoffCapture } from "@pe/agent-contracts";

import { SavedTakeoffsRoute } from "#/takeoff/saved-review";
import { useTakeoffsController } from "#/takeoff/controller";
import { TakeoffsPage } from "#/takeoff/route-workspace";

export function TakeoffsRoute({ target = "", work }: { target?: string; work?: string }) {
  // `?work=<capture>` names a saved capture; otherwise the route binds the live target.
  if (work) return <SavedTakeoffsRoute capture={work} />;
  return <LiveTakeoffsRoute target={target} />;
}

export function LiveTakeoffsRoute({ target = "" }: { target?: string }) {
  // Render mechanics only: wait for the client URL before mounting its route owner.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <TakeoffsControllerOwner target={target} url /> : null;
}

export function TakeoffsControllerOwner({
  target = "",
  thread,
  savedCapture,
  url,
}: {
  target?: string;
  thread?: string;
  savedCapture?: TakeoffCapture;
  url?: boolean;
}) {
  const store = useTakeoffsController({
    target,
    ...(thread ? { thread } : {}),
    ...(savedCapture ? { savedCapture } : {}),
    ...(url ? { url } : {}),
  });
  return <TakeoffsPage store={store} />;
}

export { takeoffsRoute, takeoffAdapters } from "./graph-route";
