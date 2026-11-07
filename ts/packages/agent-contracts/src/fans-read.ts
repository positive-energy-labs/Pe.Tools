import { publicationRequest, publicationSchema } from "./value.ts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsDocumentSchema } from "./ducts.ts";
import { fansDocumentSchema } from "./fans.ts";
import { z } from "zod";
import {
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
} from "./ducts-sheet.ts";
import { documentRefSchema } from "./target.ts";

const detail = ductsSheetResponseSchema.options;
export const openFanSheetSchema = z.object({
  overview: ductsSheetOverviewSchema,
  inputs: detail[4].nullable(),
  elements: detail[2].nullable(),
  legs: detail[1].nullable(),
  worstLegs: z.array(detail[1]),
  worksheet: detail[3].nullable(),
});
export const fanSheetSchema = z.object({
  open: openFanSheetSchema.nullable(),
  opened: z.array(openFanSheetSchema).optional(),
  rows: ductsRosterResponseSchema.shape.rows,
  progress: z
    .object({ done: z.number(), total: z.number(), mark: z.string(), stopped: z.boolean() })
    .nullable(),
});
export const FAN_READ_MAX = 32;
export const fansReadArgs = z.object({
  target: documentRefSchema,
  fan: z.union([z.literal("all"), z.array(z.string()).max(FAN_READ_MAX)]),
  sheetPath: z.string().default(""),
});
export const fansReadRequest = publicationRequest(fansReadArgs);

export const fansSheetData = fanSheetSchema.extend({
  espOptions: nativeResponseSchema("revit.catalog.field-options").nullable(),
  espOptionsError:z.string().nullable(),
  sheetView: z.object({
    blockers: detail[4].shape.blockers,
    tiers: z.record(z.enum(["taken", "accept", "preview"]), z.number()),
    taken: z.array(z.string()),
    inputs: detail[4].shape.inputs.nullable(),
    firm: detail[4].shape.firm.nullable(),
  }),
  design: z.object({ ...fansDocumentSchema.shape, ...ductsDocumentSchema.shape }),
  fans: ductsRosterResponseSchema,
  ductsWork: ductsDocumentSchema,
  fansWork: fansDocumentSchema,
  sheetSnapshot: z.union([
    nativeResponseSchema("ducts.snapshot.walk").and(
      z.object({ sourceVersion: z.string().optional() }),
    ),
    z.object({ kind: z.literal("absent") }),
  ]),
});
export const fansReadResponse = publicationSchema(fansSheetData);

/** Both clients reference this host read's contract; no browser composition adapter owns it. */
export const fansSheetCapability = {
  key: "fans.sheet" as const,
  input: fansReadArgs.omit({ target: true }),
  output: fansReadResponse,
  axes: { subject: "Document", touches: ["Metadata"], effect: "Read", cost: "Cheap", cardinality: "One" } as const,
};
