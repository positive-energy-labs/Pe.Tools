/**
 * Whether an update consent is in flight: the POST that admits the plan stays open while the host
 * closes Revits, and no receipt exists to show for it yet. Module state, like the drawer door,
 * because the consent button and the app-shell scrim live in unrelated subtrees.
 */
let accepting = false;
const listeners = new Set<() => void>();

export const isAccepting = () => accepting;

export const subscribeAccepting = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function setAccepting(next: boolean) {
  accepting = next;
  for (const listener of listeners) listener();
}
