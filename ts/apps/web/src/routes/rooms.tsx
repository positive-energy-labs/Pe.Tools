import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { urlPage } from "#/route";
import { RoomsRoute } from "#/rooms/route";
import { manifest } from "#/rooms/manifest";

const url = urlPage(manifest)!;

export const Route = createFileRoute("/rooms")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...url.read(search),
    /** Region labels, comma separated (`R12,R3`): selected and zoomed to once drawn. */
    focus: typeof search.focus === "string" && search.focus ? search.focus : undefined,
    /** Solver layers drawn on the plan, comma separated (`rails,openings`); absent = none. */
    layers: typeof search.layers === "string" && search.layers ? search.layers : undefined,
  }),
  search: { middlewares: [...url.middlewares] },
  component: RoomsFileRoute,
});

function RoomsFileRoute() {
  const navigate = useNavigate({ from: "/rooms" });
  const { focus, layers } = Route.useSearch();
  return (
    <RoomsRoute
      focus={focus ?? ""}
      layers={layers ?? ""}
      setLayers={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, layers: next || undefined }),
          replace: true,
        })
      }
    />
  );
}
