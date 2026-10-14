import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { message, type PodRouteDescriptor } from "@pe/agent-contracts";
import { useRouterState } from "@tanstack/react-router";
import { peClient } from "#/host/pe-client";
import { readPeError } from "@pe/host-contracts/pe-api";
import { publicRoutes } from "./builtin-routes";
import { createPodRouteLoader, verifyBundle } from "./pod-loader";
import { makePodRoute, type PodRouteBundle } from "./pod-view";
import { setPodAddresses } from "./pod-address";

type Inventory = {
  rows: PodRouteDescriptor[];
  errors: Readonly<Record<string, string>>;
  loading: boolean;
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
            return publicRoutes.register(route);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch (error) {
          setErrors((prior) => ({ ...prior, [row.key]: message(error) }));
          throw error;
        }
      }),
    [],
  );
  const refresh = () => setRevision((prior) => prior + 1);
  const publish = useCallback(
    async (next: PodRouteDescriptor[]) => {
      setRows(next);
      setPodAddresses(next);
      setErrors({});
      await loader.sync(next);
    },
    [loader],
  );
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
      .then((next) => {
        if (controller.signal.aborted) return;
        return publish(next);
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return;
        await publish([]);
        setErrors({ inventory: message(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [publish, revision, pathname]);
  const trust = async (row: PodRouteDescriptor, trusted: boolean) => {
    const next = await peClient.call("plugins.routeTrust", {
      params: { key: row.key },
      body: { sha256: row.sha256, trusted },
    });
    await publish(next);
  };
  return <Context value={{ rows, errors, loading, trust }}>{children}</Context>;
}
