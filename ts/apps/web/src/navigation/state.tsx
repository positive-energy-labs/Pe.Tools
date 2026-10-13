import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { navigationClient, type NavigationSnapshot } from "./navigation-client";
import { admittedDestination } from "./model";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { appRouteMount } from "@pe/agent-contracts";
import { useSurfaceHost } from "./surface-host";

type NavigationState = {
  snapshot: NavigationSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};
const Context = createContext<NavigationState | null>(null);
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<NavigationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const refresh = useCallback(() => setVersion((prior) => prior + 1), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void navigationClient(resolveWorkbenchConfig().origin)
      .read(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setSnapshot(next);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version, pathname]);
  return <Context value={{ snapshot, loading, error, refresh }}>{children}</Context>;
}
export function useNavigation() {
  const value = use(Context);
  if (!value) throw new Error("NavigationProvider is required");
  return value;
}
export function useDestination() {
  const navigate = useNavigate();
  const host = useSurfaceHost();
  return useCallback(
    (destination: string) => {
      const admitted = admittedDestination(destination, window.location.origin);
      if (!admitted) return false;
      const url = new URL(admitted, window.location.origin);
      if (host.surface === "tray" && !appRouteMount(url.pathname, "tray"))
        return host.openFullWindow(url.href);
      const search = Object.fromEntries(url.searchParams);
      void navigate({
        to: url.pathname,
        search: {
          ...search,
          thread: search.thread ?? undefined,
          target: search.target ?? undefined,
          shell: host.surface === "tray" ? "tray" : undefined,
        },
        hash: url.hash.slice(1),
      });
      return true;
    },
    [navigate, host],
  );
}
