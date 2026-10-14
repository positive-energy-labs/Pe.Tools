import { createFileRoute } from "@tanstack/react-router";

import { BindRoute } from "#/pages-bind/picker";

/** `/bind?page=<slug>`: the human door to a Page's binding, opened by the Page's chip. */
export const Route = createFileRoute("/bind")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: typeof search.page === "string" ? search.page : "",
    view: search.view === "1" || search.view === 1,
  }),
  component: Bind,
});

function Bind() {
  const { page, view } = Route.useSearch();
  return <BindRoute slug={page} view={view} />;
}
