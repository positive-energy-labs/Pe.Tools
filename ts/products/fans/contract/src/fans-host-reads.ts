import { z } from "zod";
import { contract } from "@pe/agent-contracts/handle";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsRosterRequestSchema, ductsRosterResponseSchema } from "./calc-read.ts";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { fansDocumentSchema } from "./fans.ts";
import { ductsBaseSchema } from "@pe/ducts-contract/duct-inputs";
import { catalogTableSchema } from "@pe/ducts-contract/duct-catalog";
import { ductsFanCalcSchema } from "./fan-calc-data.ts";
export const fanRoster = contract("fans.roster", {
  input: ductsRosterRequestSchema,
  data: ductsRosterResponseSchema,
  uses: ["ducts.snapshot.roster"],
});
/** Pure fan pricing over the caller's acquired network; the system projection never imports its engine. */
export const networkCalcs = contract("fans.network-calcs", {
  input: z.object({
    snapshot: nativeResponseSchema("ducts.snapshot.walk"),
    tables: nativeResponseSchema("ducts.tables"),
    catalogs: z.record(z.string(), catalogTableSchema),
    design: fansDocumentSchema.extend(ductsDocumentSchema.shape),
    firm: ductsBaseSchema,
    revision: z.number(),
  }),
  data: z.array(ductsFanCalcSchema),
  uses: [],
});
