import { z } from "zod";
import { currentCaller, requireHuman } from "./control.ts";
import type { createContributionContent } from "./pe-routes.ts";
export function createPluginsHandler(content: ReturnType<typeof createContributionContent>) {
  return async (request: Request) => {
    const caller = currentCaller();
    await content.lifecycle.ready;
    const json = (value: unknown, status = 200) => Response.json(value, { status });
    if (request.method === "GET") {
      await content.lifecycle.refresh();
      return json(content.lifecycle.inventory());
    }
    requireHuman(caller, "/pe/plugins", "manage plugin lifecycle");
    await content.lifecycle.refresh();
    const id = decodeURIComponent(new URL(request.url).pathname.slice("/pe/plugins/".length));
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
