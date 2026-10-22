import { createFileRoute } from "@tanstack/react-router";

import { OpsRoute } from "#/ops/workspace";
import { routeFile, useAddressPage } from "#/route";

export const Route = createFileRoute("/ops")({
  ...routeFile("ops"),
  component: OpsFileRoute,
});

function OpsFileRoute() {
  return <OpsRoute page={useAddressPage("ops")} />;
}
