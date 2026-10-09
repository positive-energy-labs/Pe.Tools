/**
 * Whether the machine drawer is open, and at which group. Module state, because the door (the
 * version chip) and its callers (a provider that needs a sign-in) live in unrelated subtrees.
 */
import type { GroupKey } from "./model";

export type DrawerState = { readonly open: boolean; readonly group: GroupKey | undefined };

let drawer: DrawerState = { open: false, group: undefined };
const listeners = new Set<() => void>();

export const drawerState = () => drawer;

export const subscribeDrawer = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const publish = (next: DrawerState) => {
  drawer = next;
  for (const listener of listeners) listener();
};

/** Open the drawer from anywhere, at a group (a provider that needs a sign-in opens Pea). */
export const openMachine = (group?: GroupKey) => publish({ open: true, group });

export const closeMachine = () => publish({ open: false, group: undefined });
