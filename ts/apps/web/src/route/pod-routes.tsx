import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { peClient } from "#/host/pe-client";
import { readPeError } from "@pe/host-contracts/pe-api";
import { publicRoutes } from "./builtin-routes";
import { defineRoutePlugin } from "@pe/kit/route-registry";
import { createPodRouteLoader, verifyBundle, type PodRouteDescriptor } from "./pod-loader";
import { makePodRoute, type PodRouteBundle } from "./pod-view";
import { setPodAddresses } from "./pod-address";

type Inventory = {
  rows: PodRouteDescriptor[];
  errors: Readonly<Record<string, string>>;
  loading: boolean;
  refresh: () => void;
  trust: (row: PodRouteDescriptor, trusted: boolean) => Promise<void>;
};
const Context = createContext<Inventory | null>(null);
export function usePodRoutes() {
  return use(Context);
}

export function PodRoutesProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<PodRouteDescriptor[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const loader = useMemo(
    () =>
      createPodRouteLoader(async (row) => {
        try {
          const response = await peClient.response("plugins.routeBundle", {
            params: { key: row.key, hash: row.sha256 },
          });
          if (!response.ok) throw Error((await readPeError(response)).message);
          const bytes = new Uint8Array(await response.arrayBuffer());
          await verifyBundle(bytes, row.sha256);
          const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
          try {
            const bundle = (await import(/* @vite-ignore */ url)) as PodRouteBundle;
            const route = makePodRoute(row, bundle);
            return publicRoutes.register(defineRoutePlugin(route));
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch (error) {
          setErrors((prior) => ({
            ...prior,
            [row.key]: error instanceof Error ? error.message : String(error),
          }));
          throw error;
        }
      }),
    [],
  );
  const refresh = () => setRevision((prior) => prior + 1);
  useEffect(() => {
    const timer = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      loader.dispose();
      setPodAddresses([]);
    };
  }, [loader]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void peClient
      .call("plugins.routes", {}, { signal: controller.signal })
      .then(async (next) => {
        if (controller.signal.aborted) return;
        setRows(next);
        setPodAddresses(next);
        setErrors({});
        await loader.sync(next);
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return;
        setRows([]);
        setPodAddresses([]);
        await loader.sync([]);
        setErrors({ inventory: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loader, revision, pathname]);
  const trust = async (row: PodRouteDescriptor, trusted: boolean) => {
    const next = await peClient.call("plugins.routeTrust", {
      params: { key: row.key },
      body: { sha256: row.sha256, trusted },
    });
    setRows(next);
    setPodAddresses(next);
    setErrors({});
    await loader.sync(next);
  };
  return <Context value={{ rows, errors, loading, refresh, trust }}>{children}</Context>;
}
