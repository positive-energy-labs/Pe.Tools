import { useMemo } from "react";
import { systemsOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { useRouteViewBridge } from "#/route/view-bridge";
import type { PageMove } from "#/route/manifest";
import type { DuctsPage } from "./manifest";

/**
 * What the Ducts page tells Pea it shows: its address (`routeAddresses.ducts`), and the system
 * names and levels the page can take, so a person's word resolves to a system the page
 * knows. The subject is a Revit system; group ids never reach Pea.
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
    }),
    [snapshot],
  );
  useRouteViewBridge({
    route: "ducts",
    thread,
    surface,
    visible: true,
    page,
    // Choosing a system by hand clears the selection and issue; Pea's patch does the same, as one step.
    apply: (patch) =>
      setPage(
        {
          ...(patch as Partial<DuctsPage>),
          ...("system" in patch && !("selected" in patch) ? { selected: "" } : {}),
          ...(("system" in patch || "selected" in patch) && !("issue" in patch)
            ? { issue: "" }
            : {}),
        },
        { history: "push" },
      ),
    context: { document },
    facts,
  });
}
