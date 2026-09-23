import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FamiliesWorkspace } from "#/families/workspace";
import { useFamiliesStore } from "#/families/store";
import { DEFAULT_FAMILIES_RULES } from "#/families/pivot-rules";
import { entitySearch, useRouteThread, type EntitySearch } from "#/route";
import { routeSearch } from "#/route/route-owner";

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** `?demo=<action>` mounts one seed of `manifest.seeds`; stage, pod and path are the page in the URL. */
export const familiesSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & EntitySearch & { demo?: string; query?: string } => {
  const entry = entitySearch(search);
  return {
    ...routeSearch(search),
    ...entry,
    stage:
      search.stage === "audit" || search.stage === "apply" || search.stage === "archived"
        ? search.stage
        : undefined,
    demo: str(search.demo) || undefined,
    query: typeof search.query === "string" ? search.query : undefined,
  };
};

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target, stage, pod, path, query } = Route.useSearch();
  const thread = useRouteThread();
  return (
    <FamiliesRouteContent
      target={target}
      thread={thread}
      entry={{ stage, pod, path }}
      query={query ?? DEFAULT_FAMILIES_RULES}
      surface="route"
      url
    />
  );
}

export function FamiliesRouteContent({
  target = "",
  thread,
  entry,
  query,
  url = false,
  visible = true,
  surface = "route",
}: {
  target?: string;
  thread?: string;
  /** The URL page state, read once at mount. */
  entry?: EntitySearch;
  /** The URL's rule line; absent on embedded chat panes. */
  query?: string;
  /** True only on the route itself; a chat pane does not own the URL. */
  url?: boolean;
  visible?: boolean;
  surface?: "chat" | "route";
}) {
  const navigate = useNavigate();
  const store = useFamiliesStore({
    target,
    thread,
    query,
    entry: entry && Object.fromEntries(Object.entries(entry).filter(([, value]) => value)),
  });
  const previousQuery = useRef(store.table.query);
  useEffect(() => {
    if (!url || previousQuery.current === store.table.query) return;
    previousQuery.current = store.table.query;
    void navigate({
      to: ".",
      replace: true,
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        query: store.table.query === DEFAULT_FAMILIES_RULES ? undefined : store.table.query,
      }),
    });
  }, [url, store.table.query, navigate]);
  return (
    <FamiliesWorkspace
      store={store}
      url={url}
      thread={thread}
      visible={visible}
      surface={surface}
    />
  );
}
