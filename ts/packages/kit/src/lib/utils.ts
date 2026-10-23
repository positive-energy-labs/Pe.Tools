import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Focus without the browser's scroll-into-view (N1): focus moves, the view stays. A caller that
 *  answers a key the person pressed scrolls explicitly. */
export function focusQuiet(element: HTMLElement | null | undefined) {
  element?.focus({ preventScroll: true });
}
