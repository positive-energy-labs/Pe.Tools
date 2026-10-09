/**
 * The reskin-lab registry: the four prototype directions and the one owner of `data-theme`.
 * Each direction owns `src/theme/<name>.css` (loaded from styles.css after the house layers);
 * this module owns the attribute and its storage, so the direction seam and the light/dark mode
 * machinery never write the same key twice. Ruling: docs/features/design-system/LEDGER.md
 * (reskin-lab, 2026-10-09). Prototype scope — the lab lives on the `reskin/lab` branch.
 */
export const reskinThemes = ["phosphor", "drafting", "folio", "hardline"] as const;

export type ReskinTheme = (typeof reskinThemes)[number];

export const RESKIN_STORAGE_KEY = "pe.reskinTheme";

/** Apply the direction to the live document. `null` clears the attribute — the default look. */
export function applyReskinTheme(theme: ReskinTheme | null): void {
  const root = document.documentElement;
  if (theme) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  try {
    window.localStorage.setItem(RESKIN_STORAGE_KEY, theme ?? "");
  } catch {
    // The direction still applies for this page when storage is unavailable.
  }
}

/** The stored direction, for the switcher's initial state. Boot applies the direction before
 *  first paint through RESKIN_INIT_SCRIPT (routes/__root.tsx), not through this function —
 *  the inline script runs at parse time, a module call cannot. */
export function initialReskinTheme(): ReskinTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(RESKIN_STORAGE_KEY);
    return reskinThemes.includes(stored as ReskinTheme) ? (stored as ReskinTheme) : null;
  } catch {
    return null;
  }
}
