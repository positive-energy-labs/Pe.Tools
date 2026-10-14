import { z } from "zod";
import { matchPeRoute } from "@pe/agent-contracts/pe-api";
import type { createContributionContent } from "./pe-routes.ts";
import { createPodRoutes } from "./pod-routes.ts";
export function createPluginsHandler(
  content: ReturnType<typeof createContributionContent>,
  routes = createPodRoutes(content.lifecycle),
) {
  return async (request: Request) => {
    const declared = matchPeRoute(request.method, new URL(request.url).pathname);
    if (!declared || declared.route.owner !== "plugins")
      return Response.json({ error: "Unknown plugin route" }, { status: 404 });
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
        const body = z
          .strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), trusted: z.boolean() })
          .parse(await request.json());
        return json(await routes.trust(declared.params.key, body.sha256, body.trusted));
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
    if (request.method === "GET") {
      await content.lifecycle.refresh();
      return json(content.lifecycle.inventory());
    }
    await content.lifecycle.refresh();
    const id = declared.params.id;
    if (!content.lifecycle.inventory().some((p) => p.id === id))
      return json({ error: "Unknown plugin" }, 404);
    if (request.method === "DELETE") await content.lifecycle.remove(id);
    else {
      const parsed = z.strictObject({ enabled: z.boolean() }).safeParse(await request.json());
      if (!parsed.success) return json({ error: "Expected {enabled: boolean}" }, 400);
      await content.lifecycle.setEnabled(id, parsed.data.enabled);
    }
    await content.read();
    await routes.list();
    return json(content.lifecycle.inventory());
  };
}
