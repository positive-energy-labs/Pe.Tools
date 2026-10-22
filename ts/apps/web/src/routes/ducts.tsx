import { createFileRoute } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { urlPage } from "#/route";
import { DuctsRoute } from "#/ducts/route";
import { manifest } from "#/ducts/manifest";

const url = urlPage(manifest)!;

export const Route = createFileRoute("/ducts")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...url.read(search),
  }),
  search: { middlewares: [...url.middlewares] },
  component: DuctsRoute,
});
