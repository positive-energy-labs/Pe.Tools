import { createFileRoute } from "@tanstack/react-router";

import { entitySearch, routeSearch, useRouteThread, type EntitySearch } from "#/route";
import { FamilyRouteView } from "#/route/family/live";
import { familyManifest } from "#/route/family/manifest";

/** The route, declared once. `route/family/live.tsx` binds it to the family audit and the pods. */
export const manifest = familyManifest();

export const familySearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> &
  EntitySearch & {
    demo?: string;
    capture?: boolean;
  } => ({
  ...routeSearch(search),
  // A deep link (`/pods`, a chat pane) names the stage and member the route opens on.
  ...entitySearch(search),
  capture: search.capture === true || search.capture === "true" ? true : undefined,
  /** `?demo=<action>` mounts one seed of `manifest.seeds`. */
  demo: typeof search.demo === "string" && search.demo.trim() ? search.demo.trim() : undefined,
});

export const Route = createFileRoute("/family")({
  validateSearch: familySearch,
  component: FamilyRoute,
});

function FamilyRoute() {
  const { target, capture, stage, pod, path } = Route.useSearch();
  const thread = useRouteThread();
  return (
    <FamilyRouteView
      target={target ?? null}
      thread={thread}
      capture={capture}
      initial={Object.fromEntries(
        Object.entries({ stage, pod, path }).filter(([, value]) => value),
      )}
    />
  );
}
