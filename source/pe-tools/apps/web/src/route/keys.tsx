/**
 * Every chord in the app is a TanStack hotkey registration carrying ONE meta shape, whichever tier
 * bound it: a root or route manifest action (this file), a pane's `shortcuts` (`lang/pane.tsx`),
 * or a widget's own `useHotkeys`. The help page reads the registrations back and joins each one
 * to the region that bound it — there is no second list of keys anywhere.
 */
import { useMemo, useRef } from "react";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";

import type { RouteHandle } from "./use-route";
import type { Refusal } from "./refusal";

/** What `options.meta` carries on every registration. `region` is a pane id, absent on a manifest chord. */
export interface KeyMeta {
  name: string;
  description: string;
  tier: "root" | "route" | "pane" | "widget";
  region?: string;
  /** The sentence the chord would refuse with right now; null or absent when it runs. */
  refusal?: string | null;
}

export const keyMeta = (meta: KeyMeta): KeyMeta => meta;

/** The registration view's meta, or nothing for a chord bound without one (a library default). */
export const readKeyMeta = (meta: unknown): KeyMeta | null =>
  meta && typeof meta === "object" && "tier" in meta ? (meta as KeyMeta) : null;

/** Binds every declared chord; a refused chord still fires and the refusal is surfaced. */
export function RouteKeys<W, R extends string, P, A extends string>({
  handle,
  onRefusal,
}: {
  handle: RouteHandle<W, R, P, A>;
  onRefusal?: (refusal: Refusal) => void;
}) {
  // `useHotkeys` re-registers whenever the definition array changes identity, and registering
  // notifies the hotkey store, which re-renders — a fresh array per render is an infinite loop.
  // The definitions are therefore memoised on a string of (name, chord, refusal) and read the live
  // handle and the live `onRefusal` through refs, so a callback is stable but never stale. The
  // refusal is in the key so the registration's meta — what help shows — tracks `ready()`.
  const latest = useRef(handle);
  latest.current = handle;
  const refusalRef = useRef(onRefusal);
  refusalRef.current = onRefusal;
  const names = (Object.keys(handle.actions) as A[]).filter(
    (name) => handle.actions[name].chord !== undefined,
  );
  const key = JSON.stringify(
    names.map((name) => [name, handle.actions[name].chord, handle.actions[name].refusal]),
  );
  const definitions = useMemo(
    (): UseHotkeyDefinition[] =>
      (JSON.parse(key) as [A, string, string | null][]).map(([name, hotkey, refusal]) => {
        const action = latest.current.actions[name];
        return {
          hotkey: hotkey as UseHotkeyDefinition["hotkey"],
          callback: () => {
            void latest.current.actions[name].run().then((refused) => {
              if (refused) refusalRef.current?.(refused);
            });
          },
          options: {
            ignoreInputs: true,
            meta: keyMeta({ name: action.label, description: action.says, tier: "route", refusal }),
          },
        };
      }),
    [key],
  );
  useHotkeys(definitions);
  return null;
}
