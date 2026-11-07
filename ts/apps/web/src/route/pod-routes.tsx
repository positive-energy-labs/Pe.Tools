import { currentFixture } from "#/shell/fixture-lane";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { message, type PodRouteDescriptor } from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { readPeError } from "@pe/host-contracts/pe-api";
import { registerTypedRoute } from "../shell/route-registration";
import { loadPodRoute } from "./pod-artifact";
import { createPodRouteLoader } from "./pod-loader";

import {PodRoutesContext} from "./pod-route-context";
export {usePodRoutes} from "./pod-route-context";

export function PodRoutesProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<PodRouteDescriptor[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const { loader, publish } = useMemo(() => {
    const loader = createPodRouteLoader(async (row, current) => {
      try {
        const fixture =
          currentFixture() !== null ? (await import("./pod-fixtures")).podFixtures() : null;
        let artifact: unknown;
        if (fixture) {
          const entry = (await fixture).find((entry) => entry.row.key === row.key);
          if (!entry) throw Error("Unknown Pod fixture");
          artifact = entry.envelope;
        } else {
          const response = await peClient.response("plugins.routeBundle", {
            params: { key: row.key, hash: row.fingerprint },
          });
          if (!response.ok) throw Error((await readPeError(response)).message);
          artifact = await response.json();
        }
        const route = await loadPodRoute(row, artifact);
        if (!current()) return () => {};
        return registerTypedRoute(route.module, route.fingerprint);
      } catch (error) {
        if (current()) setErrors((prior) => ({ ...prior, [row.key]: message(error) }));
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
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      loader.dispose();
    };
  }, [loader]);
  useEffect(() => {
    const controller = new AbortController();
    const inventory =
      currentFixture() !== null
        ? import("./pod-fixtures")
            .then((m) => m.podFixtures())
            .then((entries) => entries.map((entry) => entry.row))
        : peClient.call("plugins.routes", {}, { signal: controller.signal });
    void inventory
      .then((next) => {
        if (controller.signal.aborted) return;
        return publish(next);
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return;
        setErrors({ inventory: message(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [publish, revision]);
  const trust = async (row: PodRouteDescriptor, trusted: boolean) => {
    const next = await peClient.call("plugins.routeTrust", {
      params: { key: row.key },
      body: { fingerprint: row.fingerprint, trusted },
    });
    await publish(next);
  };
  return <PodRoutesContext value={{ rows, errors, loading, trust }}>{children}</PodRoutesContext>;
}
