import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { readTeaching, registerTeaching, subscribeTeaching, type TeachDescriptor } from "./teach";
import { registerTeachingMeasure, subscribeMeasuredTeaching, teachingBox } from "./teach-measure";

export const TeachRegion = createContext<string | undefined>(undefined);
export const TeachLive = createContext(true);
/** Folded controls teach through their visible trigger, even while the popup is closed. */
export const TeachOwner = createContext<RefObject<HTMLElement | null> | undefined>(undefined);
/** Read the same words the primitive draws, including composed labels; never call a component. */
export const teachText = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode; "aria-hidden"?: boolean }>(child)
        ? child.props["aria-hidden"]
          ? ""
          : teachText(child.props.children)
        : typeof child === "string" || typeof child === "number"
          ? String(child)
          : "",
    )
    .join("");

export function useTeach(
  descriptor: TeachDescriptor | null,
  enabled = true,
  host?: HTMLElement | null | RefObject<HTMLElement | null>,
) {
  const id = useId();
  const parent = useContext(TeachRegion);
  host = useContext(TeachOwner) ?? host;
  const live = useContext(TeachLive) && enabled;
  const region = descriptor?.kind === "region" ? id : parent;
  const value = JSON.stringify(descriptor);
  useEffect(() => {
    const fact = JSON.parse(value) as TeachDescriptor | null;
    if (!live || !fact) return;
    const anchor = host && ("current" in host ? host.current : host);
    const owner = region ?? anchor?.closest<HTMLElement>("[data-teach-id]")?.dataset.teachId;
    const pane = document.querySelector<HTMLElement>(`[data-teach-id="${owner}"]`);
    const nodes = [...new Set([anchor, pane])].filter((node) => node != null);
    let previous: string | undefined;
    let withdraw: (() => void) | undefined = registerTeaching({ ...fact, id, region: owner });
    const measure = () => {
      const next = { ...fact, id, region: owner };
      if (next.kind === "region" && pane) {
        next.label =
          pane.querySelector('[data-slot="pane-title"]')?.textContent?.trim() ||
          pane.querySelector("[data-list-view][aria-label]")?.getAttribute("aria-label") ||
          next.label;
        const { left, top, width, height } = teachingBox(pane);
        next.rect = { left, top, width, height };
      }
      const stamp = nodes.every(
        (node) => node.isConnected && teachingBox(node).width > 0 && teachingBox(node).height > 0,
      )
        ? JSON.stringify(next)
        : "";
      if (stamp === previous) return;
      previous = stamp;
      withdraw?.();
      withdraw = stamp ? registerTeaching(next) : undefined;
    };
    const unmeasure = registerTeachingMeasure({ nodes, measure });
    return () => {
      unmeasure();
      withdraw?.();
    };
  }, [id, region, live, value, host]);
  return id;
}
export const useTeaching = () =>
  useSyncExternalStore(subscribeMeasuredTeaching, readTeaching, readTeaching);
export const useTeachingFacts = () =>
  useSyncExternalStore(subscribeTeaching, readTeaching, readTeaching);
