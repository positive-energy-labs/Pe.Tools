import { useRouteNavigate, useRouteSearch } from "#/route/activity";
import { createFileRoute, stripSearchParams, type SearchSchemaInput } from "@tanstack/react-router";

import { readLink } from "@pe/agent-contracts";
import { OpsRoute } from "#/ops/workspace";
import { routeSearch } from "#/route/route-owner";

export const Route = createFileRoute("/ops")({
  validateSearch: (search: SearchSchemaInput & Record<string, unknown>) => ({
    ...routeSearch(search),
    ...readLink("ops", search).page,
  }),
  // The contract defaults never reach the address, as on `/` and `/pea`.
  search: { middlewares: [stripSearchParams(readLink("ops", {}).page)] },
  component: OpsFileRoute,
});

function OpsFileRoute() {
  const search = useRouteSearch("ops");
  const navigate = useRouteNavigate();
  return (
    <OpsRoute
      op={search.op}
      actionId={search.actionId || null}
      set={(patch) => {
        void navigate({
          to: "/ops",
          search: (previous) => ({ ...previous, ...patch }),
          replace: true,
        });
      }}
    />
  );
}
