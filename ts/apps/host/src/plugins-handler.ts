import { z } from "zod";
import { matchPeRoute } from "@pe/agent-contracts/pe-api";
import type { createContributionContent } from "./pe-routes.ts";
export function createPluginsHandler(content: ReturnType<typeof createContributionContent>) {
  return async (request: Request) => {
    const declared = matchPeRoute(request.method, new URL(request.url).pathname);
    if (!declared || declared.route.owner !== "plugins")
      return Response.json({ error: "Unknown plugin route" }, { status: 404 });
    await content.lifecycle.ready;
    const json = (value: unknown, status = 200) => Response.json(value, { status });
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
    return json(content.lifecycle.inventory());
  };
}
