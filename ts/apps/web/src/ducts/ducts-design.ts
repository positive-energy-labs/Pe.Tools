import { workRead } from "@pe/host/reads/inputs";
import { z } from "zod";
import { ductsDocumentSchema, ductsFirmSchema, fansDocumentSchema, documentRefSchema } from "@pe/agent-contracts";
import { firmReading } from "@pe/host/ducts-files";
import { FIRM_SEED } from "@pe/host/ducts-inputs";
import { read, workScope } from "@pe/host/read-graph";
export const designLayers = read("ducts.design-layers", {
  input: documentRefSchema,
  output: z.object({
    ducts: ductsDocumentSchema,
    fans: fansDocumentSchema,
    revision: z.number(),
    fansRevision: z.number(),
    firm: firmReading,
  }),
  async run(ctx, target) {
    const scope = await ctx.read(workScope, target);
    const ducts = await ctx.read(workRead("ducts", ductsDocumentSchema), scope);
    const fans = await ctx.read(workRead("fans", fansDocumentSchema), { ...scope, route: "fans" });
    return {
      ducts: ductsDocumentSchema.parse(ducts?.doc ?? {}),
      fans: fansDocumentSchema.parse(fans?.doc ?? {}),
      revision: ducts?.revision ?? 0,
      fansRevision: fans?.revision ?? 0,
      firm: await ctx.firm("ducts", ductsFirmSchema, FIRM_SEED),
    };
  },
});
