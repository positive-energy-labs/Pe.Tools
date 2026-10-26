import { useMemo } from "react";
import { useRouteLease } from "#/route/view-bridge";
import { applyFamiliesQuery, buildPivot, FAMILIES_QUERY_HELP } from "./pivot";
import type { FamiliesWorkspaceModel } from "./workspace";

/**
 * What the Families pane tells Pea it shows (`routeAddress("families").agent`): the visible
 * reading, its counts under the query line, the rule help, and in History the past reads.
 */
export function FamiliesLease({
  model,
  url,
  visible,
}: {
  model: FamiliesWorkspaceModel;
  url: boolean;
  visible: boolean;
}) {
  const { store, lastReading, rows, params, families, tableState } = model;
  const query = tableState.query;
  const pivot = useMemo(() => buildPivot(rows, params, families), [rows, params, families]);
  const counts = useMemo(() => {
    const filtered = applyFamiliesQuery(query, pivot.pivotRows, pivot.pivotFamilies);
    return {
      families: filtered.shownFamilies.length,
      types: filtered.shownFamilies.reduce((sum, family) => sum + family.types, 0),
      parameters: filtered.shownRows.length,
    };
  }, [pivot, query]);
  const history = store.page.stage === "history";
  useRouteLease("families", store.handle.page, {
    thread: store.handle.thread ?? undefined,
    url,
    visible,
    context: {
      stage: store.page.stage,
      readingId: lastReading?.id ?? null,
      document: lastReading?.document ?? store.documentTarget,
      work: lastReading?.work ?? store.handle.work.key,
    },
    facts: {
      ruleHelp: FAMILIES_QUERY_HELP,
      counts,
      ...(history
        ? {
            past: store.archive.list.map((read) => ({
              id: read.id,
              completedAt: read.completedAt,
              afterApply: Boolean(read.readback),
            })),
          }
        : {}),
    },
  });
  return null;
}
