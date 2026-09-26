import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { RoomsRoute } from "#/rooms/route";

export const Route = createFileRoute("/rooms")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    view: typeof search.view === "string" && search.view ? search.view : undefined,
    /** Region labels, comma separated (`R12,R3`): selected and zoomed to once drawn. */
    focus: typeof search.focus === "string" && search.focus ? search.focus : undefined,
    /** Solver layers drawn on the plan, comma separated (`rails,openings`); absent = none. */
    layers: typeof search.layers === "string" && search.layers ? search.layers : undefined,
  }),
  component: RoomsFileRoute,
});

function RoomsFileRoute() {
  const navigate = useNavigate({ from: "/rooms" });
  const { view, focus, layers } = Route.useSearch();
  return (
    <RoomsRoute
      view={view ?? ""}
      focus={focus ?? ""}
      layers={layers ?? ""}
      setLayers={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, layers: next || undefined }),
          replace: true,
        })
      }
      setView={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, view: next || undefined }),
          replace: true,
        })
      }
    />
  );
}
