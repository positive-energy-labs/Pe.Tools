import { createFileRoute } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { urlPage } from "#/route";
import { DuctsRoute } from "#/ducts/route";
import { manifest } from "#/ducts/manifest";

const url = urlPage(manifest)!;

// ponytail: `?view=sheet` is a bare search param until `RouteManifest.views` gets a real slot
// (design-system ledger, Owed); then the sheet registers there and this goes.
export const Route = createFileRoute("/ducts")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...url.read(search),
    ...(search.view === "sheet" ? { view: "sheet" as const } : {}),
  }),
  search: { middlewares: [...url.middlewares] },
  component: DuctsPage,
});

function DuctsPage() {
  const { view } = Route.useSearch();
  return <DuctsRoute view={view} />;
}
