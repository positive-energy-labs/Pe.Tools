/**
 * Journey readers (slice 6.1): a scripted journey waits on the kernel's settledness marks only,
 * never on prose ("Reading...") or a timer. The marks, and the selectors a CDP journey uses too:
 * - `[aria-busy="true"]` on a slot region while its reading is pending (kit `Pane`, kernel-derived);
 * - `[data-url-settled]` on a Place's route root once its URL holds its Page and a parseable `?target`;
 * - `[inert]` on a hidden Place, so nothing inside it answers a name.
 */
import { waitFor } from "@testing-library/react";

const BUSY = '[aria-busy="true"]';
/** The shown copy only: a hidden Place is inert. */
export const SHOWN = ":not([inert] *)";

/** Resolves when `region` and everything in it is settled. */
export const settled = (region: Element, timeout = 10_000) =>
  waitFor(() => {
    const busy = region.matches(BUSY) ? region : region.querySelector(BUSY);
    if (busy) throw Error(`still busy: ${busy.getAttribute("aria-label") ?? busy.getAttribute("data-work") ?? busy.tagName}`);
  }, { timeout });

/** Resolves with the shown Place's route root once its URL write is flushed. */
export const urlSettled = (timeout = 10_000) =>
  waitFor(() => {
    const root = document.querySelector<HTMLElement>(`[data-url-settled]${SHOWN}`);
    if (!root) throw Error("no shown Place has flushed its URL");
    return root;
  }, { timeout });
