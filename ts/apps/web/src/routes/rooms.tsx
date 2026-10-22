import { createFileRoute } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { urlPage } from "#/route";
import { RoomsRoute } from "#/rooms/route";
import { manifest } from "#/rooms/manifest";

const url = urlPage(manifest)!;

export const Route = createFileRoute("/rooms")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...url.read(search),
  }),
  search: { middlewares: [...url.middlewares] },
  component: RoomsFileRoute,
});

function RoomsFileRoute() {
  return <RoomsRoute />;
}
