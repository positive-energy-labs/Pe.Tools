import { useMemo } from "react";
import { DUCTS_LAYERS, viewportCodec } from "@pe/agent-contracts";
import { systemsOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { useRouteViewBridge } from "#/route/view-bridge";
import type { PageMove } from "#/route/manifest";
import type { DuctsPage } from "./manifest";

/**
 * What the Ducts page tells Pea it shows: its address (`routeAddresses.ducts`), and the system
 * names and levels the page can take, so a person's word resolves to a system the page
 * knows; the picture's layer names; and the orbit pose the model picture shows (`page.pose`, the
 * fit resolved from bounds when the viewport key is null), so a named look turns that pose. The
 * subject is a Revit system; group ids never reach Pea.
 */
export function useDuctsViewBridge({
  thread,
  surface,
  page,
  setPage,
  snapshot,
  document,
}: {
  thread?: string;
  surface: "chat" | "route";
  page: DuctsPage;
  setPage: (patch: Partial<DuctsPage>, move?: PageMove<DuctsPage>) => void;
  snapshot: DuctSnapshot | null;
  document: unknown;
}) {
  const facts = useMemo(
    () => ({
      systems: (snapshot ? systemsOf(snapshot) : []).slice(0, 800).map((system) => ({
        name: system.name,
        classification: system.classification,
        units: system.units.slice(0, 8),
        networks: system.groups.length,
      })),
      levels: (snapshot?.levels ?? []).map((level) => ({ id: String(level.id), name: level.name })),
      layers: [
        ...new Set([...DUCTS_LAYERS, ...(snapshot?.layers ?? []).map((layer) => layer.key)]),
      ],
      ...(page.pose ? { pose: viewportCodec.encode(page.pose) } : {}),
    }),
    [snapshot, page.pose],
  );
  useRouteViewBridge({
    route: "ducts",
    thread,
    surface,
    visible: true,
    page,
    // A Pea patch is one navigation; the manifest's `transition` couples system, selection and pose.
    apply: (patch) => setPage(patch as Partial<DuctsPage>, { history: "push" }),
    context: { document },
    facts,
  });
}
