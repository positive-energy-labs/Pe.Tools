import { createFileRoute } from "@tanstack/react-router";

import { z } from "zod";
import { defineRoute, urlPage } from "#/route";
import { BindRoute } from "#/pages-bind/picker";

const manifest = defineRoute({
  key: "bind",
  name: "Bind",
  page: z.object({
    page: z.string().default(""),
    view: z
      .preprocess((value) => value === true || value === "1" || value === 1, z.boolean())
      .default(false),
  }),
  url: ["page", "view"],
});
const url = urlPage(manifest)!;

/** `/bind?page=<slug>`: the human door to a Page's binding, opened by the Page's chip. */
export const Route = createFileRoute("/bind")({
  validateSearch: (search: Record<string, unknown>) => manifest.page!.parse(url.read(search)),
  search: { middlewares: [...url.middlewares] },
  component: Bind,
});

function Bind() {
  const { page, view } = Route.useSearch();
  return <BindRoute slug={page} view={view} />;
}
