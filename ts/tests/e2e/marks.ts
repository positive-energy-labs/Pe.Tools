// The kernel's settledness marks (slice 6.1), read from a real page. The same marks the jsdom
// readers in apps/web/src/test-journey.ts wait on; a CDP journey waits on nothing else.
import type { Page } from "./cdp.ts";

/**
 * An open kit overlay: the Base UI popup the kit draws (kit `popover-internal.tsx`, `dialog.tsx`),
 * which carries `data-open` only while open. A persistent listbox (the Pea thread list) is not one.
 */
export const LAYER = ':is([data-slot="popover-content"], [data-slot="dialog-content"])[data-open]';

export type Marks = {
  /** Some shown region's read or compute is unsettled. */
  busy: boolean;
  /** The shown Place has flushed its URL write. */
  urlSettled: boolean;
  /** An open overlay offers options. */
  picker: boolean;
};

/** Runs in Chrome; self-contained. A hidden Place is inert, so nothing inside it counts. */
export function readMarks(layer: string): Marks {
  const shown = ":not([inert] *)";
  return {
    busy: !!document.querySelector(`[aria-busy="true"]${shown}`),
    urlSettled: !!document.querySelector(`[data-url-settled]${shown}`),
    picker: !!document.querySelector(`${layer} [role="option"]`),
  };
}

export const marks = (page: Pick<Page, "evaluate">) => page.evaluate(readMarks, LAYER);
/** The shown Place holds its URL, nothing shown is busy, and no picker waits for a choice. */
export const settled = (m: Marks) => m.urlSettled && !m.busy && !m.picker;
