import { createFileRoute } from "@tanstack/react-router";
import { routeSearch } from "#/route/route-owner";
import { SheetRoute } from "#/sheet/route";

export const Route = createFileRoute("/sheet")({
  validateSearch: routeSearch,
  component: SheetRoute,
});
