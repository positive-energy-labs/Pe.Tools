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
    let previous = "";
    let withdraw: (() => void) | undefined;
    const measure = () => {
      const visible = nodes.every((node) => {
        const rect = node.getBoundingClientRect();
        return node.isConnected && rect.width > 0 && rect.height > 0;
      });
      const label =
        fact.kind === "region"
          ? pane?.querySelector('[data-slot="pane-title"]')?.textContent?.trim() ||
            pane?.querySelector("[data-list-view][aria-label]")?.getAttribute("aria-label") ||
            fact.label
          : undefined;
      const next = visible
        ? JSON.stringify({ ...fact, ...(label ? { label } : {}), id, region: owner })
        : "";
      if (next === previous) return;
      previous = next;
      withdraw?.();
      withdraw = next ? registerTeaching(JSON.parse(next)) : undefined;
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    nodes.forEach((node) => resize?.observe(node));
    const mutation = new MutationObserver(measure);
    mutation.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "hidden", "class"],
      characterData: true,
    });
    return () => {
      resize?.disconnect();
      mutation.disconnect();
      withdraw?.();
    };
  }, [id, region, live, value, host]);
  return id;
}
export const useTeaching = () =>
  useSyncExternalStore(subscribeTeaching, readTeaching, readTeaching);
