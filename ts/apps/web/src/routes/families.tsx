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
): ReturnType<typeof routeSearch> & EntitySearch & { demo?: string; rules?: string } => {
  const entry = entitySearch(search);
  return {
    ...routeSearch(search),
    ...entry,
    stage:
      search.stage === "audit" || search.stage === "apply" || search.stage === "archived"
        ? search.stage
        : undefined,
    demo: str(search.demo) || undefined,
    rules: typeof search.rules === "string" ? search.rules : undefined,
  };
};

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target, stage, pod, path, rules } = Route.useSearch();
  const thread = useRouteThread();
  return (
    <FamiliesRouteContent
      target={target}
      thread={thread}
      entry={{ stage, pod, path }}
      rules={rules ?? DEFAULT_FAMILIES_RULES}
      surface="route"
      url
    />
  );
}

export function FamiliesRouteContent({
  target = "",
  thread,
  entry,
  rules,
  url = false,
  visible = true,
  surface = "route",
}: {
  target?: string;
  thread?: string;
  /** The URL page state, read once at mount. */
  entry?: EntitySearch;
  /** The URL's rule line; absent on embedded chat panes. */
  rules?: string;
  /** True only on the route itself; a chat pane does not own the URL. */
  url?: boolean;
  visible?: boolean;
  surface?: "chat" | "route";
}) {
  const navigate = useNavigate();
  const store = useFamiliesStore({
    target,
    thread,
    rules,
    entry: entry && Object.fromEntries(Object.entries(entry).filter(([, value]) => value)),
  });
  const previousRules = useRef(store.table.rules);
  useEffect(() => {
    if (!url || previousRules.current === store.table.rules) return;
    previousRules.current = store.table.rules;
    void navigate({
      to: ".",
      replace: true,
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        rules: store.table.rules === DEFAULT_FAMILIES_RULES ? undefined : store.table.rules,
      }),
    });
  }, [url, store.table.rules, navigate]);
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
