import { workBinding, workRead } from "@pe/host-internal/reads/work";
import { z } from "zod";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { ductsFirmSchema } from "@pe/ducts-contract/duct-inputs";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { documentRefSchema, settingTiersSchema } from "@pe/agent-contracts";
import { read } from "@pe/host-internal/read-graph";
// The decoded firm layer: the firm file against this product's schema, or the refusal.
const firmReading = z.union([
  z.strictObject({
    firm: ductsFirmSchema,
    path: z.string(),
    present: z.boolean(),
    error: z.string().optional(),
  }),
  z.strictObject({ refused: z.literal("no-shared-root") }),
]);
export const designLayers = read("ducts.design-layers", {
  input: documentRefSchema,
  output: z.object({
    ducts: ductsDocumentSchema,
    fans: fansDocumentSchema,
    revision: z.number(),
    fansRevision: z.number(),
    firm: firmReading,
    /** Every home tier's `Settings/ducts.json` for this model: the project tier feeds the engine, and the sheet labels by it. */
    settings: settingTiersSchema,
  }),
  async run(ctx, target) {
    // The duct network's Work is another product's; this reading names the route it reads.
    const scope = await ctx.read(workBinding, { route: "duct-systems", target });
    if (!scope) throw Error("This document has no Work binding");
    const ducts = await ctx.read(workRead("duct-systems", ductsDocumentSchema), scope);
    const fans = await ctx.read(workRead("fans", fansDocumentSchema), { ...scope, route: "fans" });
    return {
      ducts: ductsDocumentSchema.parse(ducts?.doc ?? {}),
      fans: fansDocumentSchema.parse(fans?.doc ?? {}),
      revision: ducts?.revision ?? 0,
      fansRevision: fans?.revision ?? 0,
      firm: await ctx.files.firm("ducts", ductsFirmSchema, {}),
      settings: await ctx.files.tiers("ducts", target),
    };
  },
});
