import { useMemo } from "react";
import { useRouteViewBridge } from "#/route/view-bridge";
import { applyFamiliesQuery, buildPivot, FAMILIES_QUERY_HELP } from "./pivot";
import type { FamiliesWorkspaceModel } from "./workspace";

/** What the Families pane tells Pea it shows: the rule line it may set, and the visible reading. */
export function FamiliesViewBridge({
  model,
  thread,
  visible,
  surface,
}: {
  model: FamiliesWorkspaceModel;
  thread?: string;
  visible: boolean;
  surface: "chat" | "route";
}) {
  const { store, lastReading, rows, params, families, tableState } = model;
  const query = tableState.query ?? "";
  const pivot = useMemo(() => buildPivot(rows, params, families), [rows, params, families]);
  const counts = useMemo(() => {
    const filtered = applyFamiliesQuery(query, pivot.pivotRows, pivot.pivotFamilies);
    return {
      families: filtered.shownFamilies.length,
      types: filtered.shownFamilies.reduce((sum, family) => sum + family.types, 0),
      parameters: filtered.shownRows.length,
    };
  }, [pivot, query]);
  const stage = store.page.stage;
  useRouteViewBridge({
    route: "families",
    thread,
    surface,
    visible: visible && (stage === "audit" || stage === "apply" || stage === "archived"),
    page: store.page,
    apply: (patch) => store.setPage({ query: patch.query }, { history: "push" }),
    context: {
      stage,
      readingId: lastReading?.id ?? null,
      document: lastReading?.document ?? store.documentTarget,
      work: lastReading?.work ?? store.handle.work.key,
    },
    facts: { ruleHelp: FAMILIES_QUERY_HELP, counts },
  });
  return null;
}
