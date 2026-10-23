import { useReachChannel, useReachSetter, useReachState } from "@pe/kit/lang/reach";
import { useEffect } from "react";

/** Canvas picks and list rows speak through the same Revit identity channel. */
export function useSceneReach() {
  const channel = useReachChannel();
  const hovered = useReachState(channel, (state) => state.hovered);
  const set = useReachSetter("hovered");
  return {
    hovered,
    onHover: set,
  };
}

/** SVG marks already declare Revit targets for the native menu. They need no route adapter. */
export function useStageReach(host: HTMLElement | null) {
  const channel = useReachChannel();
  useEffect(() => {
    if (!host) return;
    const marks = () => [...host.querySelectorAll<SVGElement>("svg [data-revit-ids]")];
    const ids = (mark: Element) => mark.getAttribute("data-revit-ids")!.split(",").map(Number);
    const paint = () => {
      const { hovered, lighting } = channel.get();
      for (const mark of marks()) {
        const targets = ids(mark);
        mark.dataset.reach = targets.includes(lighting.focus!)
          ? "focus"
          : targets.includes(hovered!)
            ? "hover"
            : targets.some((id) => lighting.ids.has(id))
              ? "reach"
              : "rest";
      }
    };
    const hover = (event: PointerEvent) => {
      const mark =
        event.target instanceof Element ? event.target.closest("svg [data-revit-ids]") : null;
      const hovered = mark && host.contains(mark) ? (ids(mark)[0] ?? null) : null;
      channel.set((state) => (state.hovered === hovered ? state : { ...state, hovered }));
    };
    const leave = () =>
      channel.set((state) => (state.hovered === null ? state : { ...state, hovered: null }));
    const unsubscribe = channel.subscribe(paint);
    const observer = new MutationObserver(paint);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-revit-ids"],
    });
    host.addEventListener("pointerover", hover);
    host.addEventListener("pointerleave", leave);
    paint();
    return () => {
      unsubscribe();
      observer.disconnect();
      host.removeEventListener("pointerover", hover);
      host.removeEventListener("pointerleave", leave);
      leave();
    };
  }, [host, channel]);
}
