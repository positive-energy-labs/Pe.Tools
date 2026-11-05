import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { commitAddress, rawQuery } from "#/route/url";
import { navigationClient, type NavigationSnapshot } from "./navigation-client";
import { admittedDestination } from "./model";
import { resolveWorkbenchConfig } from "#/workbench/config";
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
  const refresh = useCallback(() => setVersion((prior) => prior + 1), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
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
  }, [version]);
  return <Context value={{ snapshot, loading, error, refresh }}>{children}</Context>;
}
export function useNavigation() {
  const value = use(Context);
  if (!value) throw new Error("NavigationProvider is required");
  return value;
}
export function useDestination() {
  const router = useRouter();
  const host = useSurfaceHost();
  return useCallback(
    (destination: string) => {
      const admitted = admittedDestination(destination, window.location.origin);
      if (!admitted) return false;
      const url = new URL(admitted, window.location.origin);
      const query = url.searchParams;
      const current = rawQuery(router);
      // Tool entry neither creates nor switches a conversation: it carries the selected `?thread`
      // unchanged; only an explicit conversation link names its own. The root's other carries
      // (`work`, `fixture`) ride along as its retention middleware did; `target` is never inferred.
      for (const key of ["thread", "work", "fixture"])
        if (!query.has(key) && current.has(key)) query.set(key, current.get(key)!);
      query.delete("shell");
      if (host.surface === "tray") query.set("shell", "tray");
      void commitAddress(router, url.pathname, query, {
        state: {},
        hash: url.hash,
      });
      return true;
    },
    [router, host],
  );
}
