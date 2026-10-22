import { useRouteSearch } from "#/route/activity";
import { createFileRoute } from "@tanstack/react-router";

import { readLink, routePageSchema } from "@pe/agent-contracts";
import { defineRoute, urlPage } from "#/route";
import { routeSearch } from "#/route/route-owner";
import { BindRoute } from "#/pages-bind/picker";

const manifest = defineRoute({
  key: "bind",
  name: "Bind",
  address: "bind",
  page: routePageSchema("bind"),
});
const url = urlPage(manifest)!;

/** `/bind?page=<slug>`: the human door to a Page's binding, opened by the Page's chip. */
export const Route = createFileRoute("/bind")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...readLink("bind", search).page,
  }),
  search: { middlewares: [...url.middlewares] },
  component: Bind,
});

function Bind() {
  const { page, view } = useRouteSearch("bind");
  return <BindRoute slug={page} view={view} />;
}
