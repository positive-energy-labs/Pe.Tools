import { resources } from "@pe/host/builtin-read-handles";
import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts";
import { read } from "@pe/host/read-graph";
import { bindData, type CapabilityCatalog } from "@pe/agent-contracts";
export const reads = {
  picker: read("bind.picker", {
    input: z.object({ target: executionTargetSchema }),
    output: bindData,
    async run(ctx) {
      // The leaf decoded this with `capabilityCatalogSchema`; `leaf`'s `z.ZodType<O>` infers `unknown` through its transform.
      const catalog = (await ctx.read(resources.capabilities, { kind: "capabilities" })) as CapabilityCatalog;
      return {
        threads: await ctx.read(resources.threads, { kind: "threads" }),
        inventory: await ctx.read(resources.inventory, { kind: "inventory" }),
        // A Page row's open URL is `/pages/<slug>/`; the slug is what `page.bind` and the Page chip name.
        pages: catalog.capabilities.flatMap((row) => {
          const slug = row.kind === "page" ? /^\/pages\/([^/]+)\//.exec(row.projection?.openUrl ?? "")?.[1] : undefined;
          return slug ? [{ slug: decodeURIComponent(slug), title: row.title }] : [];
        }),
      };
    },
  }),
};
