import { RouteShell, defineRoute } from "#/route";
import { createFileRoute } from "@tanstack/react-router";

import { VariantE } from "#/param-tables/variants/variant-e";

export const manifest = defineRoute({
  key: "param-tables",
  name: "Param Tables",
  docs: "The selected parameter-table workspace. Edit linked engineering data in the table and inspect its synthetic product states.",
  views: [{ key: "workspace", label: "Parameter workspace", draws: () => <VariantE /> }],
});

function RouteShelledVariantE() {
  return <RouteShell manifest={manifest}>{manifest.views![0]!.draws({ readings: {} })}</RouteShell>;
}

export const Route = createFileRoute("/param-tables")({
  component: RouteShelledVariantE,
});
