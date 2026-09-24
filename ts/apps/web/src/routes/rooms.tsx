import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { RoomsRoute } from "#/rooms/route";

export const Route = createFileRoute("/rooms")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    view: typeof search.view === "string" && search.view ? search.view : undefined,
  }),
  component: RoomsFileRoute,
});

function RoomsFileRoute() {
  const navigate = useNavigate({ from: "/rooms" });
  const { view } = Route.useSearch();
  return (
    <RoomsRoute
      view={view ?? ""}
      setView={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, view: next || undefined }),
          replace: true,
        })
      }
    />
  );
}
