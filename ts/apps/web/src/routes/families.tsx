import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FamiliesWorkspace } from "#/families/workspace";
import { useFamiliesStore } from "#/families/store";
import { DEFAULT_FAMILIES_QUERY, manifest } from "#/families/manifest";
import { urlPage, useRouteThread } from "#/route";
import { routeSearch } from "#/route/route-owner";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const url = urlPage(manifest)!;

/** `?demo=<action>` mounts one seed of `manifest.seeds`; the Page's `url` keys are the manifest's. */
export const familiesSearch = (search: Record<string, unknown>) => ({
  ...routeSearch(search),
  ...url.read(search),
  demo: str(search.demo) || undefined,
  query: typeof search.query === "string" ? search.query : undefined,
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  search: { middlewares: [...url.middlewares] },
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target, query } = Route.useSearch();
  const thread = useRouteThread();
  return (
    <FamiliesRouteContent
      target={target}
      thread={thread}
      query={query ?? DEFAULT_FAMILIES_QUERY}
      surface="route"
      url
    />
  );
}

export function FamiliesRouteContent({
  target = "",
  thread,
  query,
  url = false,
  visible = true,
  surface = "route",
}: {
  target?: string;
  thread?: string;
  /** The URL's rule line; absent on embedded chat panes. */
  query?: string;
  /** True only on the route itself; a chat pane does not own the URL. */
  url?: boolean;
  visible?: boolean;
  surface?: "chat" | "route";
}) {
  const navigate = useNavigate();
  const store = useFamiliesStore({ target, thread, query, url });
  const previousQuery = useRef(store.table.query);
  useEffect(() => {
    if (!url || previousQuery.current === store.table.query) return;
    previousQuery.current = store.table.query;
    void navigate({
      to: ".",
      replace: true,
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        query: store.table.query === DEFAULT_FAMILIES_QUERY ? undefined : store.table.query,
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
