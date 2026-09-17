import { createFileRoute } from "@tanstack/react-router";

import { routeSearch } from "#/route";
import { FamilyRouteView } from "#/route/family/live";
import { familyManifest } from "#/route/family/manifest";

/** The route, declared once. `route/family/live.tsx` binds it to the family audit and the pods. */
export const manifest = familyManifest();

export const familySearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & {
  pod?: string;
  path?: string;
  thread?: string;
  demo?: string;
  capture?: boolean;
} => ({
  ...routeSearch(search),
  // A deep link (`/pods`, a chat pane) names the member the route opens on.
  pod: typeof search.pod === "string" && search.pod ? search.pod : undefined,
  path: typeof search.path === "string" && search.path ? search.path : undefined,
  capture: search.capture === true || search.capture === "true" ? true : undefined,
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  /** `?demo=<action>` mounts one seed of `manifest.seeds`. */
  demo: typeof search.demo === "string" && search.demo.trim() ? search.demo.trim() : undefined,
});

export const Route = createFileRoute("/family")({
  validateSearch: familySearch,
  component: FamilyRoute,
});

function FamilyRoute() {
  const { target, thread, capture, pod, path } = Route.useSearch();
  return (
    <FamilyRouteView
      target={target ?? null}
      thread={thread}
      capture={capture}
      initial={pod && path ? { pod, path } : undefined}
    />
  );
}
