import { z } from "zod";
import { contract } from "./handle.ts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsRosterRequestSchema, ductsRosterResponseSchema } from "./ducts-sheet.ts";
import { ductsDocumentSchema } from "./ducts.ts";
import { fansDocumentSchema } from "./fans.ts";
import { ductsBaseSchema } from "./duct-inputs.ts";
import { catalogTableSchema } from "./duct-catalog.ts";
import { ductsFanCalcSchema } from "./ducts-read.ts";
export const fanRoster = contract("fans.roster", { input: ductsRosterRequestSchema, data: ductsRosterResponseSchema, uses: ["ducts.snapshot.roster"] });
export const espOptions = contract("fans.esp-options", {
  input: z.object({ target: ductsRosterRequestSchema.shape.target, units: z.array(z.string()) }),
  data: z.object({ espOptions: nativeResponseSchema("revit.catalog.field-options").nullable(), espOptionsError: z.string().nullable() }),
  uses: ["revit.catalog.field-options"],
});
/** Pure fan pricing over the caller's acquired network; the system projection never imports its engine. */
export const networkCalcs = contract("fans.network-calcs", {
  input: z.object({ snapshot: nativeResponseSchema("ducts.snapshot.walk"), tables: nativeResponseSchema("ducts.tables"),
    catalogs: z.record(z.string(), catalogTableSchema), design: fansDocumentSchema.extend(ductsDocumentSchema.shape), firm: ductsBaseSchema, revision: z.number() }),
  data: z.array(ductsFanCalcSchema), uses: [],
});
