import { currentFixture } from "#/shell/fixture-lane";
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { message, validatePodSource, type PodRouteDescriptor } from "@pe/agent-contracts";
import { useRouterState } from "@tanstack/react-router";
import { peClient } from "#/host/pe-client";
import { readPeError } from "@pe/host-contracts/pe-api";
import { publicRoutes } from "./builtin-routes";
import { createPodRouteLoader, verifyBundle } from "./pod-loader";
import { makePodRoute, type PodRouteBundle } from "./pod-view";

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
  const { loader, publish } = useMemo(() => {
    const loader = createPodRouteLoader(async (row, current) => {
      try {
        const fixture = currentFixture() !== null ? (await import("./pod-fixtures")).podFixtures() : null;
        let bytes: Uint8Array;
        if (fixture) {
          const entry = (await fixture).find(entry => entry.row.key === row.key);
          if (!entry) throw Error("Unknown Pod fixture");
          bytes = entry.bytes;
        } else {
        const response = await peClient.response("plugins.routeBundle", {
          params: { key: row.key, hash: row.sha256 },
        });
        if (!response.ok) throw Error((await readPeError(response)).message);
        bytes = new Uint8Array(await response.arrayBuffer());
        }
        await verifyBundle(bytes, row.sha256);
        validatePodSource(new TextDecoder().decode(bytes));
        if (!current()) return () => {};
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "text/javascript" }));
        try {
          const bundle = (await import(/* @vite-ignore */ url)) as PodRouteBundle;
          if (!current()) return () => {};
          const route = makePodRoute(row, bundle);
          return publicRoutes.registerModule({ ...route.registration, bodies: route.hosted });
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (error) {
        setErrors((prior) => ({ ...prior, [row.key]: message(error) }));
        throw error;
      }
    });
    const publish = async (next: PodRouteDescriptor[]) => {
      setRows(next);
      setErrors({});
      await loader.sync(next);
    };
    return { loader, publish };
  }, []);
  const refresh = () => setRevision((prior) => prior + 1);
  useEffect(() => {
    const timer = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      loader.dispose();
    };
  }, [loader]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const inventory = currentFixture() !== null
      ? import("./pod-fixtures").then(m => m.podFixtures()).then(entries => entries.map(entry => entry.row))
      : peClient.call("plugins.routes", {}, { signal: controller.signal });
    void inventory
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
