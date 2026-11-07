import { circuitReadSchema, inferenceReadSchema, overridesReadSchema, stagedDuctsReadSchema } from "./ducts-pricing-read.ts";
import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { documentRefSchema } from "./target.ts";
import { ductsDocumentSchema } from "./ducts.ts";
import { fansDocumentSchema } from "./fans.ts";
import { ductFindingSchema, DUCT_INFERENCE_GRADES } from "./ducts-analysis.ts";
import { catalogTableSchema } from "./duct-catalog.ts";
import { fansReadRequest, fansReadResponse, fansSheetData } from "./fans-read.ts";

const numberOrNull = z.number().nullable();
export const ductsPriceRow = z
  .object({
    id: z.number(),
    kind: z.enum(["friction", "fitting", "tap-branch", "tap-straight", "terminal"]),
    dp: numberOrNull,
    desc: z.string(),
    rule: z.string().optional(),
    leg:z.enum(["C","Cb","Cs","ps"]).optional(),
    source:catalogTableSchema.shape.source.optional(),
    finding:z.enum(["catalog-missing-link","catalog-missing-table","catalog-input","catalog-out-of-range","no-rule"]).optional(),
    inputs:z.object({res:z.enum(["Co","Cb","Cs"]),x:z.number(),y:z.number().optional(),xLabel:z.string(),yLabel:z.string().optional(),notes:z.array(z.string()).optional()}).optional(),
    implausible:z.object({coefficient:z.number(),res:z.enum(["Co","Cb","Cs"]),fpm:z.number(),cfm:z.number(),reasons:z.array(z.enum(["drop","velocity"]))}).optional(),
    table: z.string().optional(),
    c: z.number().optional(),
    pv: z.number().optional(),
    fpm: z.number().optional(),
    lengthFt: z.number().optional(),
    roughnessFt: z.number().optional(),
    rate: z.number().optional(),
    eqFt: numberOrNull.optional(),
    family: z.string().optional(),
    staticInWg: numberOrNull.optional(),
    revitDp: z.number().optional(),
    notes: z.array(z.string()).optional(),
    error: z.string().optional(),
  });
const splitPart=z.object({dp:z.number(),ids:z.array(z.number()),unpriced:z.number()});
const split=z.object({rows:z.array(ductsPriceRow).readonly(),unit:splitPart,duct:splitPart,terminal:splitPart,groups:z.array(z.object({key:z.string(),part:z.enum(["unit","duct","terminal"]),element:z.enum(["duct","fitting","unit","terminal"]),label:z.string(),dp:z.number(),ids:z.array(z.number()),unpriced:z.number()}))});
const provisional=z.object({worst:z.enum(DUCT_INFERENCE_GRADES),count:z.number(),findingIds:z.array(z.string())}).nullable();
const systemRow = z
  .object({
    key: z.string(),
    name: z.string(),
    kind: z.literal("system"),
    groups: z.array(z.string()),
    classification: z.string().nullable(),
    sub: z.string(),
    rating: numberOrNull,
    total: numberOrNull,
    fanless: z.boolean(),
    blocked: z.boolean(),
    id:numberOrNull,self:numberOrNull,ft:numberOrNull,selfFt:numberOrNull,rate:numberOrNull,unpriced:numberOrNull,
    split:split.nullable(),level:numberOrNull,scale:numberOrNull,critical:numberOrNull,provisional,terminal:numberOrNull,children:z.array(z.never()),
  });
export const ductsRosterArgs = z.object({ target: documentRefSchema });
export const DUCTS_SYSTEM_MAX = 512;
export const ductsNetworkArgs = ductsRosterArgs.extend({
  system: z.union([z.literal("all"), z.array(z.string()).max(DUCTS_SYSTEM_MAX)]),
});
export const ductsNetworkData = nativeResponseSchema("ducts.snapshot.walk").and(
  z.object({
    sourceVersion: z.string(),
    systemReads: z.object({ completed: z.array(z.number()), missing: z.array(z.number()) }),
  }),
);
export const ductsRosterData = nativeResponseSchema("ducts.snapshot.roster").and(
  z.object({ sourceVersion: z.string(), rows: z.array(systemRow) }),
);
const record = <T extends z.ZodType>(schema: T) => z.record(z.string(), schema);
const flow = z.object({
  cfm: numberOrNull,
  source: z.string().nullable(),
  grilles: z.number().optional(),
  finding: z.literal("no-flow").optional(),
});
const path = z.object({
  groupId: z.string(),
  total: z.number(),
  tel: z.number(),
  path: z.array(z.number()),
  rows: z.array(ductsPriceRow),
  inferred: z.array(z.string()),
  provisional,
});
const fan = z.object({
  unit: z.number(),
  cfm: numberOrNull,
  port: numberOrNull,
  junction: numberOrNull,
  owned: z.array(z.number()),
  esp: z.number(),
  critical: numberOrNull,
  tel: numberOrNull,
  stretch: z.array(ductsPriceRow),
  viaJunction: z.boolean(),
  path: z.array(z.number()),
  rows: z.array(ductsPriceRow),
});
const loss = z.object({
  // The circuit solver's complete evidence is retained as JSON; renderers need no circuit engine.
  design: circuitReadSchema(ductsPriceRow),
  paths: record(path),
  fan: z.number(),
  critical: numberOrNull,
  provisional,
  byGroup: record(
    z.object({
      fan: numberOrNull,
      critical: numberOrNull,
      criticalTel: numberOrNull,
      criticalFan: numberOrNull,
      revitCritical: numberOrNull,
      hasAirMover: z.boolean(),
      implausible: z.array(z.number()),
      provisional,
      fans: z.array(fan),
    }),
  ),
  byRule: record(
    z.object({ critical: z.number(), per: record(z.number()), instances: z.number() }),
  ),
  errors: z.array(
    z.object({
      id: z.number(),
      rule: z.string().optional(),
      table: z.string().optional(),
      message: z.string(),
    }),
  ),
  crossClass: z.array(
    z.object({
      id: z.number(),
      from: z.number(),
      classification: z.string(),
      fromClassification: z.string(),
      cfm: z.number(),
    }),
  ),
});
export const ductsPricingData = z.object({
  espOptions: nativeResponseSchema("revit.catalog.field-options").nullable(),
  espOptionsError:z.string().nullable(),
  fanRows: fansSheetData.shape.rows,
  design: fansDocumentSchema.extend(ductsDocumentSchema.shape),
  effectiveDesign: fansDocumentSchema.extend(ductsDocumentSchema.shape),
  network: ductsNetworkData,
  ductsWork: ductsDocumentSchema,
  fansWork: fansDocumentSchema,
  catalogFindings: z.array(z.string()),
  priced: z.object({
    snapshot: nativeResponseSchema("ducts.snapshot.walk"),
    flows: record(flow),
    equipmentFlows: record(flow),
    fanFlows: record(record(flow)),
    roles: record(
      z.object({
        role: z.enum(["fan", "passive"]),
        why: z.enum(["ruled", "edit", "proposed"]),
        reason: z.string(),
      }),
    ),
    findings: z.array(ductFindingSchema),
    inferred: z.array(
      z.object({
        between: z.tuple([z.number(), z.number()]),
        id: z.string(),
        grade: z.enum(DUCT_INFERENCE_GRADES),
        ruled: z.boolean(),
      }),
    ),
    catalogs: record(catalogTableSchema),
    applied: record(z.string()),
    choices: record(z.string()),
    overrides: overridesReadSchema,
    now: loss,
    next: loss,
    edit: stagedDuctsReadSchema,
  }),
  ready: record(
    z.object({
      level: z.enum(["blocked", "walkable", "budgetable"]),
      walk: z.array(z.string()),
      budget: z.array(z.string()),
    }),
  ),
  analysis: z.object({
    heal: z.object({
      groups: z.array(
        z.object({
          group: z.string(),
          items: z.array(
            z.object({
              key: z.string(),
              kind: z.enum(["cap", "join"]),
              how: z.enum(["cap", "connect", "union", "extend"]),
              end: z.string(),
              other: z.string().optional(),
              gapIn: z.number(),
              ids: z.array(z.number()),
              covers: z.array(z.string()),
            }),
          ),
        }),
      ),
      covered: z.array(z.string()),
      hard: record(
        z.object({ ids: z.array(z.number()), covers: z.array(z.string()), note: z.string() }),
      ),
    }),
    notes: record(z.object({ fix: z.number(), set: z.number() })),
    systems: z.array(systemRow),
    inference: inferenceReadSchema,
  }),
});
/** Same publication/Value protocol as Fans; only the semantic data and args vary. */
const requestFields = fansReadRequest.omit({ args: true });
export const ductsReadRequest = z.discriminatedUnion("read", [
  requestFields.extend({ read: z.literal("ducts.roster"), args: ductsRosterArgs }),
  requestFields.extend({ read: z.literal("ducts.network"), args: ductsNetworkArgs }),
  requestFields.extend({ read: z.literal("ducts.pricing"), args: ductsNetworkArgs }),
]);
const publicationOf = <T extends z.ZodType>(data: T) =>
  fansReadResponse.extend({
    value: fansReadResponse.shape.value.unwrap().extend({ data }).nullable(),
  });
export const ductsRosterReadResponse = publicationOf(ductsRosterData);
export const ductsNetworkReadResponse = publicationOf(ductsNetworkData);
export const ductsPricingReadResponse = publicationOf(ductsPricingData);
// Network is the richer snapshot shape; roster-first decoding would strip its batch coverage.
export const ductsReadResponse = z.union([
  ductsNetworkReadResponse,
  ductsRosterReadResponse,
  ductsPricingReadResponse,
]);
export type DuctsRosterData = z.infer<typeof ductsRosterData>;
export type DuctsNetworkData = z.infer<typeof ductsNetworkData>;
export type DuctsPricingData = z.infer<typeof ductsPricingData>;

const axes = {
  subject: "Document",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const ductsRosterCapability = {
  key: "ducts.roster.value",
  endpoint: "ducts.read",
  request: () => ({ read: "ducts.roster" }),
  input: ductsRosterArgs.omit({ target: true }),
  output: ductsRosterReadResponse,
  axes,
} as const;
export const ductsNetworkCapability = {
  key: "ducts.network.value",
  endpoint: "ducts.read",
  request: () => ({ read: "ducts.network" }),
  input: ductsNetworkArgs.omit({ target: true }),
  output: ductsNetworkReadResponse,
  axes,
} as const;
export const ductsPricingCapability = {
  key: "ducts.pricing.value",
  endpoint: "ducts.read",
  request: () => ({ read: "ducts.pricing" }),
  input: ductsNetworkArgs.omit({ target: true }),
  output: ductsPricingReadResponse,
  axes,
} as const;

