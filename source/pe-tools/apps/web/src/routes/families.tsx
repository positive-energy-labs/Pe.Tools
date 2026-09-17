import { createFileRoute } from "@tanstack/react-router";

import { FamiliesWorkspace } from "#/families/workspace";
import { useFamiliesStore } from "#/families/store";
import { entitySearch, routeSearch, type EntitySearch } from "#/route";

import { manifest as familiesManifest } from "#/families/manifest";
export const manifest = familiesManifest;

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** `?demo=<action>` mounts one seed of `manifest.seeds`; stage, pod and path are the page in the URL. */
export const familiesSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & EntitySearch & { thread?: string; demo?: string } => ({
  ...routeSearch(search),
  ...entitySearch(search),
  thread: str(search.thread) || undefined,
  demo: str(search.demo) || undefined,
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target, thread, stage, pod, path } = Route.useSearch();
  return <FamiliesRouteContent target={target} thread={thread} entry={{ stage, pod, path }} url />;
}

export function FamiliesRouteContent({
  target = "",
  thread,
  entry,
  url = false,
}: {
  target?: string;
  thread?: string;
  /** The URL page state, read once at mount. */
  entry?: EntitySearch;
  /** True only on the route itself; a chat pane does not own the URL. */
  url?: boolean;
}) {
  const store = useFamiliesStore({
    target,
    thread,
    entry: entry && Object.fromEntries(Object.entries(entry).filter(([, value]) => value)),
  });
  return <FamiliesWorkspace store={store} url={url} />;
}
