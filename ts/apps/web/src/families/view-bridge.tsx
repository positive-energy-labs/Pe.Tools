import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FamiliesView } from "@pe/agent-contracts";
import { useHostEvents } from "#/readings";
import {
  acknowledgeFamiliesQuery,
  publishFamiliesView,
  releaseFamiliesView,
} from "#/host/families-view";
import { applyFamiliesQuery, buildPivot, FAMILIES_QUERY_HELP } from "./pivot";
import type { FamiliesWorkspaceModel } from "./workspace";

type Intent = {
  type: "families-view-intent";
  thread: string;
  instance: string;
  commandId: string;
  revision: number;
  query: string;
};
const ruleHelp = FAMILIES_QUERY_HELP;

/** The mounted view's short lived address for Pea. No Page field enters authored Work. */
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
  const instance = useRef(crypto.randomUUID());
  const revision = useRef<number | null>(null);
  const published = useRef<FamiliesView | null>(null);
  const publishing = useRef<Promise<void>>(Promise.resolve());
  const [commandIntent, setCommandIntent] = useState<Intent | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
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
  const rawView: FamiliesView | null =
    thread &&
    visible &&
    pageVisible &&
    (stage === "audit" || stage === "apply" || stage === "archived")
      ? {
          thread,
          instance: instance.current,
          surface,
          stage: stage as FamiliesView["stage"],
          query,
          ruleHelp,
          readingId: lastReading?.id ?? null,
          document: lastReading?.document ?? store.documentTarget,
          work: lastReading?.work ?? store.handle.work.key,
          counts,
        }
      : null;
  const viewKey = JSON.stringify(rawView);
  const view = useMemo(() => JSON.parse(viewKey) as FamiliesView | null, [viewKey]);
  const current = useRef(view);
  current.current = view;
  const publish = useCallback((value: FamiliesView) => {
    const next = publishing.current
      .catch(() => {})
      .then(async () => {
        const acceptedRevision = await publishFamiliesView(value);
        if (current.current === value) {
          revision.current = acceptedRevision;
          published.current = value;
        }
      });
    publishing.current = next;
    return next;
  }, []);
  useEffect(() => {
    if (!view) return;
    void publish(view).catch(() => {});
    const timer = setInterval(() => {
      if (current.current) void publish(current.current).catch(() => {});
    }, 5_000);
    return () => clearInterval(timer);
  }, [view, publish]);
  useEffect(
    () => () => {
      revision.current = null;
      published.current = null;
      publishing.current = publishing.current
        .catch(() => {})
        .then(async () => {
          await releaseFamiliesView(instance.current);
        });
    },
    [Boolean(view)],
  );
  const onEvent = useCallback(
    (event: Intent) => {
      const value = current.current;
      if (
        event.type !== "families-view-intent" ||
        !value ||
        document.visibilityState === "hidden" ||
        event.thread !== value.thread ||
        event.instance !== value.instance ||
        event.revision !== revision.current ||
        JSON.stringify(published.current) !== JSON.stringify(value)
      )
        return;
      setCommandIntent(event);
      store.setPage({ query: event.query });
    },
    [store.setPage],
  );
  useHostEvents(Boolean(view), onEvent);
  useEffect(() => {
    if (!commandIntent || !view || query !== commandIntent.query) return;
    let canceled = false;
    void publish(view)
      .then(async () => {
        if (canceled) return;
        await acknowledgeFamiliesQuery({
          instance: instance.current,
          commandId: commandIntent.commandId,
          revision: commandIntent.revision,
          query,
          counts,
        });
        if (!canceled) setCommandIntent(null);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [commandIntent, view, query, counts, publish]);
  return null;
}
