import { RouteShell, defineRoute } from "#/route";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { VariantE } from "#/param-tables/variants/variant-e";
import type { Lens } from "#/param-tables/variants/variant-e/type-values";
import { routeSearch } from "#/route/route-owner";

export const manifest = defineRoute({
  key: "param-tables",
  name: "Param Tables",
  docs: "The selected parameter-table workspace. Edit linked engineering data in the table and inspect its synthetic product states.",
  views: [{ key: "workspace", label: "Parameter workspace", draws: () => <RoutedVariantE /> }],
});

const LENSES: readonly Lens[] = ["grid", "fom", "bod"];

/** The lens is a place (N5): it rides the address, and a switch pushes so Back undoes it. */
function useLens() {
  const { lens } = Route.useSearch();
  const navigate = useNavigate({ from: "/param-tables" });
  return [
    lens ?? "grid",
    (next: Lens) =>
      void navigate({ search: (prev) => ({ ...prev, lens: next === "grid" ? undefined : next }) }),
  ] as const;
}

function RoutedVariantE() {
  return <VariantE useLens={useLens} />;
}

function RouteShelledVariantE() {
  return <RouteShell manifest={manifest}>{manifest.views![0]!.draws({ readings: {} })}</RouteShell>;
}

export const Route = createFileRoute("/param-tables")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    lens: LENSES.find((lens) => lens === search.lens),
  }),
  component: RouteShelledVariantE,
});
