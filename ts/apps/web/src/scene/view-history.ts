/** Every stage steps Page history through Alt+arrows and mouse buttons 3/4, including the native shell. */
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { useScopeKeys, useScopeLive } from "@pe/kit/keys";
import { useSurfaceHost } from "#/navigation/surface-host";

export function useViewHistory(onStep?: () => void) {
  const router = useRouter();
  const surface = useSurfaceHost();
  const live = useScopeLive();
  const go = (way: "back" | "forward") => {
    onStep?.();
    if (surface.native) surface.navigateNativeHistory(way);
    else router.history[way]();
  };
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useEffect(() => {
    if (!live) return;
    const step = (event: MouseEvent) => {
      if (event.defaultPrevented || (event.button !== 3 && event.button !== 4)) return;
      event.preventDefault();
      go(event.button === 3 ? "back" : "forward");
    };
    document.addEventListener("mouseup", step);
    return () => document.removeEventListener("mouseup", step);
  });
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
