import { useSyncExternalStore } from "react";
import { LENS_VARIANTS, type LensVariant } from "./scale";

/*
 * TEMPORARY — protoui round (wave 10, 2026-10-24), pending kaitpw's pick. The one place the lens
 * variant is read: `?lens=<id>` on any chat address is taken once at load and kept for the tab, so
 * the router's address rewrite cannot drop it; Alt+L cycles. No param, no key: `today`, unchanged.
 */
const KEY = "pe.lens.variant";
const EVENT = "pe:lens-variant";

const is = (v: unknown): v is LensVariant => (LENS_VARIANTS as readonly unknown[]).includes(v);

if (typeof window !== "undefined") {
  const fromUrl = new URLSearchParams(window.location.search).get("lens");
  if (is(fromUrl)) window.sessionStorage.setItem(KEY, fromUrl);
}

/** The picked variant, or null when none was ever picked in this tab. */
function lensVariant(): LensVariant | null {
  if (typeof window === "undefined") return null;
  const v = window.sessionStorage.getItem(KEY);
  return is(v) ? v : null;
}

export function cycleLensVariant(): LensVariant {
  const current = lensVariant() ?? "today";
  const next = LENS_VARIANTS[(LENS_VARIANTS.indexOf(current) + 1) % LENS_VARIANTS.length]!;
  window.sessionStorage.setItem(KEY, next);
  window.dispatchEvent(new Event(EVENT));
  return next;
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
};

export function useLensVariant(): LensVariant | null {
  return useSyncExternalStore(subscribe, lensVariant, () => null);
}
