import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { DuctsRoute } from "#/ducts/route";

// The router parses a numeric-looking value (`selected=8081605`, `level=5765339`) as a number.
const text = (value: unknown) =>
  typeof value === "number"
    ? String(value)
    : typeof value === "string" && value
      ? value
      : undefined;

export const Route = createFileRoute("/ducts")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    view: text(search.view),
    /** The subject group id (`g<element id>`). */
    group: text(search.group),
    /** A level element id. */
    level: text(search.level),
    /** Layer keys, comma separated (`topology,pass1-flow`); absent = none. */
    layers: text(search.layers),
    /** The selected element id. */
    selected: text(search.selected),
  }),
  component: DuctsFileRoute,
});

function DuctsFileRoute() {
  const navigate = useNavigate({ from: "/ducts" });
  const { view, group, level, layers, selected } = Route.useSearch();
  return (
    <DuctsRoute
      search={{
        view: view ?? "",
        group: group ?? "",
        level: level ?? "",
        layers: layers ?? "",
        selected: selected ?? "",
      }}
      setSearch={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            ...Object.fromEntries(
              Object.entries(next).map(([key, value]) => [key, value || undefined]),
            ),
          }),
          replace: true,
        })
      }
    />
  );
}
