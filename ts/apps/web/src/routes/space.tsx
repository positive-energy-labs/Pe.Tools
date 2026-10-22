import { createFileRoute } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { urlPage } from "#/route";
import { SpaceRoute } from "#/space/route";
import { manifest } from "#/space/manifest";

const url = urlPage(manifest)!;

export const Route = createFileRoute("/space")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...(search.demo === "fixture" ? { demo: "fixture" } : {}),
    ...url.read(search),
  }),
  search: { middlewares: [...url.middlewares] },
  component: SpaceFileRoute,
});

function SpaceFileRoute() {
  return <SpaceRoute />;
}
