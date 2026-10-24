import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "auto";
const decode = (value: string | null): ThemeMode =>
  value === "light" || value === "dark" ? value : "auto";
function storedMode(): ThemeMode {
  try {
    return typeof window === "undefined" ? "auto" : decode(window.localStorage.getItem("theme"));
  } catch {
    return "auto";
  }
}
let mode: ThemeMode | undefined;
const listeners = new Set<() => void>();
let stopListening: (() => void) | undefined;
export const readTheme = () => mode ?? (mode = storedMode());
function applyTheme() {
  if (typeof window === "undefined") return;
  const next = readTheme();
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const resolved = next === "auto" ? (dark ? "dark" : "light") : next;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
  if (next === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", next);
  document.documentElement.style.colorScheme = resolved;
}
const notify = () => listeners.forEach((listener) => listener());
export function writeTheme(next: ThemeMode) {
  mode = next;
  try {
    window.localStorage.setItem("theme", next);
  } catch {
    /* Applies without storage. */
  }
  applyTheme();
  notify();
}
/** Called after the resolved theme changes: a toggle, another tab, or the system scheme in auto. */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (readTheme() !== "auto") return;
    applyTheme();
    notify();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || (event.key !== "theme" && event.key !== null))
      return;
    mode = storedMode();
    applyTheme();
    notify();
  };
  // Re-read after an unmounted interval, when no storage listener was attached.
  if (listeners.size === 1) {
    mode = storedMode();
    window.addEventListener("storage", onStorage);
    media?.addEventListener("change", onMedia);
    stopListening = () => {
      window.removeEventListener("storage", onStorage);
      media?.removeEventListener("change", onMedia);
    };
    applyTheme();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}
export function useThemeMode() {
  return useSyncExternalStore(subscribeTheme, readTheme, () => "auto" as const);
}
