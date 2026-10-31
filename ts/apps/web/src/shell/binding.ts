import { useCallback } from "react";
import { useRouteNavigate, useRouteSearchSlice } from "../route/activity";

/**
 * The one `?target` reader/writer every shell and route shares. Grammar lives in `parseTarget`.
 * A person's pick is a named move and pushes (N5: Back returns to the previous target); only a
 * pick the page makes for them (auto-binding the one open document) replaces.
 */
export function useChooseTarget(): [
  string | null,
  (target: string | null, history?: "push" | "replace") => void,
] {
  const navigate = useRouteNavigate();
  const target = useRouteSearchSlice((search) => search.target);
  const choose = useCallback(
    (target: string | null, history: "push" | "replace" = "push") =>
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          target: target || undefined,
        }),
        replace: history === "replace",
      }),
    [navigate],
  );
  return [target ?? null, choose];
}

/**
 * The selected conversation, from `?thread`; null when none. A tool route never mints or writes
 * one: only Pea's composer starts a draft, and its first Send promotes it.
 */
export function useRouteThread(): string | null {
  return useRouteSearchSlice((search) => search.thread) ?? null;
}
