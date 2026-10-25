import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  readTeaching,
  registerTeaching,
  subscribeTeaching,
  type TeachDescriptor,
  type Teaching,
} from "./teach";
import { registerTeachingMeasure, subscribeMeasuredTeaching, teachingBox } from "./teach-measure";

export const TeachRegion = createContext<string | undefined>(undefined);
export const TeachPage = createContext<string | undefined>(undefined);
/** The current reader can sit in shell chrome outside the retained route's source boundary. */
export const TeachTarget = createContext<string | undefined>(undefined);
const EMPTY: readonly Teaching[] = [];
export const TeachReference = createContext<readonly Teaching[]>(EMPTY);
const serverTeaching = () => EMPTY;
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
  const page = useContext(TeachPage);
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
    let withdraw: (() => void) | undefined = registerTeaching({ ...fact, id, region: owner, page });
    const measure = () => {
      const next = { ...fact, id, region: owner, page };
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
  }, [id, region, live, value, host, page]);
  return id;
}
export function useTeaching() {
  const owner = useContext(TeachPage);
  const target = useContext(TeachTarget);
  const page = owner ?? target;
  const reference = useContext(TeachReference);
  const all = useSyncExternalStore(subscribeMeasuredTeaching, readTeaching, serverTeaching);
  return useMemo(() => {
    const facts = page == null ? all : all.filter((fact) => fact.page === page);
    return reference.length &&
      !facts.some(
        (fact) =>
          fact.kind === "region" && fact.rect && fact.rect.width > 0 && fact.rect.height > 0,
      )
      ? reference
      : page == null
        ? facts
        : [...all.filter((fact) => fact.page == null && fact.kind === "keys"), ...facts];
  }, [all, page, reference]);
}
export const useTeachingFacts = () =>
  useSyncExternalStore(subscribeTeaching, readTeaching, serverTeaching);
