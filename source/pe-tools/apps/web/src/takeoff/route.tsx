/**
 * The Takeoffs route mount. Target resolution, the owner, the readings and the actions are all
 * `useRoute(manifest)`; this file only chooses between the live document and a dated saved
 * capture, and remembers the browser's .r10 folders.
 */
import { useEffect, useState } from "react";
import type { TakeoffCapture } from "@pe/agent-contracts";

import { SavedTakeoffsRoute } from "#/takeoff/saved-review";
import { useTakeoffStore } from "#/takeoff/store";
import { TakeoffsPage } from "#/takeoff/route-workspace";

/** Per-browser recents — the legal-options source for the folder root. ponytail: a disk browse
 *  op would replace this; recents are enough while one firm has one takeoff folder. */
export const DIRS_KEY = "pe.takeoffs.r10-dirs";

export const readDirs = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(DIRS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((d) => typeof d === "string") : [];
  } catch {
    return [];
  }
};

export const takeoffsWorkingCopyPath = (path: string) =>
  path.toLowerCase().endsWith(".petakeoffs.rvt")
    ? path
    : path.toLowerCase().endsWith(".rvt")
      ? `${path.slice(0, -4)}.PeTakeoffs.rvt`
      : `${path}.PeTakeoffs.rvt`;

export function TakeoffsRoute({ target = "", work }: { target?: string; work?: string }) {
  // `?work=<capture>` names a saved capture; otherwise the route binds the live target.
  if (work) return <SavedTakeoffsRoute capture={work} />;
  return <LiveTakeoffsRoute target={target} />;
}

export function LiveTakeoffsRoute({ target = "" }: { target?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <TakeoffsStoreOwner target={target} /> : null;
}

export function TakeoffsStoreOwner({
  target = "",
  savedCapture,
}: {
  target?: string;
  savedCapture?: TakeoffCapture;
}) {
  const store = useTakeoffStore({
    target,
    ...(savedCapture ? { savedCapture } : {}),
    pageSeed: { views: [], zones: [], dir: "", r10: "", stage: "adopt", recentDirs: readDirs() },
  });
  return <TakeoffsPage store={store} />;
}
