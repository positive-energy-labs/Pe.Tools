import { publicationRequest, publicationSchema } from "@pe/agent-contracts/value";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsDocumentSchema } from "@pe/duct-systems-contract/ducts";
import { fansDocumentSchema } from "./fans.ts";
import { subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import { z } from "zod";
import { settingTiersSchema } from "@pe/agent-contracts/tiered-setting";
import {
  ductsRosterResponseSchema,
  ductsCalcOverviewSchema,
  ductsCalcResponseSchema,
} from "./calc-read.ts";
import { documentRefSchema } from "@pe/agent-contracts/target";

const detail = ductsCalcResponseSchema.options;
export const openFanCalcSchema = z.object({
  overview: ductsCalcOverviewSchema,
  inputs: detail[4].nullable(),
  elements: detail[2].nullable(),
  legs: detail[1].nullable(),
  worstLegs: z.array(detail[1]),
  calcBreakdown: detail[3].nullable(),
});
export const fanCalcSchema = z.object({
  open: openFanCalcSchema.nullable(),
  opened: z.array(openFanCalcSchema).optional(),
  rows: ductsRosterResponseSchema.shape.rows,
  progress: z
    .object({ done: z.number(), total: z.number(), mark: z.string(), stopped: z.boolean() })
    .nullable(),
});
export const FAN_READ_MAX = 32;
export const fansReadArgs = z.object({
  target: documentRefSchema,
  /** Fan ports as SubjectRef `UniqueId:<unit>#port:<n>` codes, decoded at this door. */
  fan: z.union([z.literal("all"), z.array(subjectRefCodeSchema).max(FAN_READ_MAX)]),
  sheetPath: z.string().default(""),
});
export const fansReadRequest = publicationRequest(fansReadArgs);

export const fansCalcData = fanCalcSchema.extend({
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
  /** Each owner's `Settings/<owner>.json` in every home tier, as the host read it: a `setting` cell's tiers (ADR 0037 rule 8). */
  settings: z.record(z.string(), settingTiersSchema),
  fans: ductsRosterResponseSchema,
  ductsWork: ductsDocumentSchema,
  /** The /ducts Work revision this read priced with: the Fans sheet's read-only line to the design it depends on. */
  ductsRevision: z.number().int().nonnegative(),
  fansWork: fansDocumentSchema,
  sheetSnapshot: z.union([
    nativeResponseSchema("ducts.snapshot.walk").and(
      z.object({ sourceVersion: z.string().optional() }),
    ),
    z.object({ kind: z.literal("absent") }),
  ]),
});
export const fansReadResponse = publicationSchema(fansCalcData);

