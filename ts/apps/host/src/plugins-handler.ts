import { matchPeRoute, peRoutes } from "@pe/agent-contracts/pe-api";
import { message } from "@pe/agent-contracts";
import type { createContributionContent } from "./pe-routes.ts";
import { createPodRoutes } from "./pod-routes.ts";

/** Served behind `servePeRoute`: the route matched and its input parsed before this runs. */
export function createPluginsHandler(
  content: ReturnType<typeof createContributionContent>,
  routes = createPodRoutes(content.lifecycle),
) {
  return async (request: Request) => {
    const declared = matchPeRoute(request.method, new URL(request.url).pathname)!;
    await content.lifecycle.ready;
    const json = (value: unknown, status = 200) => Response.json(value, { status });
    try {
      if (declared.id === "plugins.routes") return json(await routes.list());
      if (declared.id === "plugins.routeBundle")
        return new Response(await routes.bundle(declared.params.key, declared.params.hash), {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      if (declared.id === "plugins.routeTrust") {
        const body = peRoutes["plugins.routeTrust"].body.parse(await request.json());
        return json(await routes.trust(declared.params.key, body.sha256, body.trusted));
      }
    } catch (error) {
      return json({ error: message(error) }, 409);
    }
    await content.lifecycle.refresh();
    if (request.method === "GET") return json(content.lifecycle.inventory());
    const id = declared.params.id;
    if (!content.lifecycle.inventory().some((p) => p.id === id))
      return json({ error: "Unknown plugin" }, 404);
    // A Pod's folder is the user's; only its activation is host state, and PUT is its one door.
    const { enabled } = peRoutes["plugin.update"].body.parse(await request.json());
    await content.lifecycle.setEnabled(id, enabled);
    await content.read();
    await routes.list();
    return json(content.lifecycle.inventory());
  };
}
