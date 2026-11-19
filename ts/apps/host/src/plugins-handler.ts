import { matchPeRoute } from "@pe/mcps/product-catalog";
import { peRoutes } from "@pe/mcps/product-catalog";
import type { createContributionContent } from "./pe-routes.ts";

/** Served behind `servePeRoute`: the route matched and its input parsed before this runs. */
export function createPluginsHandler(
  content: ReturnType<typeof createContributionContent>,
) {
  return async (request: Request) => {
    const declared = matchPeRoute(request.method, new URL(request.url).pathname)!;
    await content.lifecycle.ready;
    const json = (value: unknown, status = 200) => Response.json(value, { status });
    if (request.method === "GET") {
      content.lifecycle.requestRefresh();
      return json(content.lifecycle.inventory());
    }
    await content.lifecycle.refresh();
    const id = declared.params.id;
    if (!content.lifecycle.inventory().some((p) => p.id === id))
      return json({ error: "Unknown plugin" }, 404);
    // A Pod's folder is the user's; only its activation is host state, and PUT is its one door.
    const { enabled } = peRoutes["plugin.update"].body.parse(await request.json());
    await content.lifecycle.setEnabled(id, enabled);
    await content.read();
    return json(content.lifecycle.inventory());
  };
}
