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
export const fansReadRequest = z.object({
  subscription: z.string().min(1).max(128),
  generation: z.number().int().nonnegative(),
  args: fansReadArgs,
  release: z.boolean().optional(),
  readSet: z.string().optional(),
});

export const fansSheetData = fanSheetSchema.extend({
  sheetView: z.object({
    blockers: detail[4].shape.blockers,
    tiers: z.record(z.enum(["taken", "accept", "preview"]), z.number()),
    taken: z.array(z.string()),
    inputs: detail[4].shape.inputs.nullable(),
    firm: detail[4].shape.firm.nullable(),
  }),
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
export const fansReadResponse = z.object({
  key: z.string(),
  generation: z.number(),
  version: z.number(),
  state: z.enum(["current", "refresh-needed", "superseded"]),
  reason: z.string().optional(),
  value: z
    .object({
      data: fansSheetData,
      evaluation: z.string(),
      inputs: z.string(),
      trace: z.array(z.unknown()),
      coverage: z.object({
        requested: z.array(z.string()),
        unknown: z.array(z.string()),
        covered: z.array(z.string()),
        refused: z.array(z.object({ keys: z.array(z.string()), reason: z.string() })),
      }),
      origin: z.unknown(),
      freshness: z.enum(["current", "refresh-needed"]),
    })
    .nullable(),
});
