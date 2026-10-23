/**
 * View history is the page's history on every stage: a named move or a selection pushes, a gesture
 * replaces, and Alt+← / Alt+→ step it the same in a browser tab, the native shell and a headless
 * one (the default is prevented, so a step happens once). Bound on the document so focus in a
 * tree, a field's neighbour or a floater still steps it.
 */
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { useScopeKeys } from "@pe/kit/keys";
import { useSurfaceHost } from "#/navigation/surface-host";

export function useViewHistory(onStep?: () => void) {
  const router = useRouter();
  const surface = useSurfaceHost();
  const go = (way: "back" | "forward") => {
    onStep?.();
    if (surface.native) surface.navigateNativeHistory(way);
    else router.history[way]();
  };
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useScopeKeys(
    [
      {
        hotkey: "Alt+ArrowLeft",
        label: "back",
        says: "Back to the previous selection and view; the camera travels there",
        callback: () => go("back"),
        options: { conflictBehavior: "allow" },
      },
      {
        hotkey: "Alt+ArrowRight",
        label: "forward",
        says: "Forward again to the next selection and view",
        callback: () => go("forward"),
        options: { conflictBehavior: "allow" },
      },
    ],
    body,
  );
  return go;
}
