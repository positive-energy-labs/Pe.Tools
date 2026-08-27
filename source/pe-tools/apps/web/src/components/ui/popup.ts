/** The shared surface contract for Base UI Select and Combobox popups. */
export const POPUP_SURFACE_CLASS =
  "rounded-[var(--radius)] bg-[var(--r-artifact)] [--r-on:var(--r-artifact)] text-[var(--r-ink)] ring-1 ring-[var(--r-line)]";

/** Combobox width: the available viewport wins when it cannot fit the requested minimum. */
export const POPUP_COMBOBOX_WIDTH_CLASS =
  "w-max min-w-[min(var(--available-width),max(var(--anchor-width),var(--popup-min-width,0px)))] max-w-(--available-width)";
