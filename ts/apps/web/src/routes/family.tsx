import { createFileRoute } from "@tanstack/react-router";

import { urlPage, useRouteThread } from "#/route";
import { routeSearch } from "#/route/route-owner";
import { FamilyRouteView } from "#/family/live";
import { familyManifest } from "#/family/manifest";

/** The route, declared once. `family/live.tsx` binds it to the family audit and the pods. */
export const manifest = familyManifest();
const url = urlPage(manifest)!;

export const familySearch = (search: Record<string, unknown>) => ({
  ...routeSearch(search),
  // A deep link (`/pods`, a chat pane) names the stage and member the route opens on.
  ...url.read(search),
  capture: search.capture === true || search.capture === "true" ? true : undefined,
  /** `?demo=<action>` mounts one seed of `manifest.seeds`. */
  demo: typeof search.demo === "string" && search.demo.trim() ? search.demo.trim() : undefined,
});

export const Route = createFileRoute("/family")({
  validateSearch: familySearch,
  search: { middlewares: [...url.middlewares] },
  component: FamilyRoute,
});

function FamilyRoute() {
  const { target, capture } = Route.useSearch();
  const thread = useRouteThread();
  return <FamilyRouteView target={target ?? null} thread={thread} capture={capture} />;
}
