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
  const live = useContext(TeachLive) && enabled;
  const region = descriptor?.kind === "region" ? id : parent;
  const value = JSON.stringify(descriptor);
  useEffect(() => {
    const fact = JSON.parse(value) as TeachDescriptor | null;
    if (!live || !fact) return;
    const anchor = host && ("current" in host ? host.current : host);
    return registerTeaching({
      ...fact,
      id,
      region: region ?? anchor?.closest<HTMLElement>("[data-teach-id]")?.dataset.teachId,
    });
  }, [id, region, live, value, host]);
  return id;
}
export const useTeaching = () =>
  useSyncExternalStore(subscribeTeaching, readTeaching, readTeaching);
