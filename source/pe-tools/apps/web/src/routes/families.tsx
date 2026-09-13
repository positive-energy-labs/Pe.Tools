import { createFileRoute } from "@tanstack/react-router";

import { FamiliesWorkspace } from "#/families/workspace";
import { useFamiliesStore } from "#/families/store";
import { routeSearch } from "#/route";

import { manifest as familiesManifest } from "#/families/manifest";
export const manifest = familiesManifest;

const str = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * `?source=fixture&fixture=native` is gone. `?demo=<action>` mounts one seed of `manifest.seeds`.
 */
export const familiesSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & { thread?: string; demo?: string } => ({
  ...routeSearch(search),
  thread: str(search.thread) || undefined,
  demo: str(search.demo) || undefined,
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  component: FamiliesRoute,
});

function FamiliesRoute() {
  return <FamiliesRouteContent target={Route.useSearch().target} />;
}

export function FamiliesRouteContent({ target = "" }: { target?: string }) {
  const store = useFamiliesStore({ target });
  return <FamiliesWorkspace store={store} />;
}
