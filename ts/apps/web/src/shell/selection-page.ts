import { useContext, useSyncExternalStore } from "react";
import { RegistryContext } from "@effect/atom-react";
import { createRouteOwner, useRouteOwner } from "./owner";
import { createViewOwner } from "../route/view-owner";

/** Auxiliary surfaces have their own subject (DOM target, tutorial region, log kind).
 * Their transient Page must not change the containing route's subject selection.
 * Domain panes use their mounted route Page directly, never this auxiliary owner.
 */
export function useSelectionPage<T>(
  surface: string,
  initial: T,
): readonly [T, (selected: T) => void] {
  const registry = useContext(RegistryContext);
  const owner = useRouteOwner(() => {
    const base = createRouteOwner(surface, registry);
    const view = createViewOwner<{ selected: T }>(base, undefined, { selected: initial });
    return {
      registry,
      view,
      dispose: () => {
        view.dispose();
        base.dispose();
      },
    };
  }, surface);
  const selected = useSyncExternalStore(
    owner.view.subscribe,
    () => owner.view.read().page.selected,
    () => owner.view.read().page.selected,
  );
  return [selected, (selected) => owner.view.setPage({ selected })];
}
