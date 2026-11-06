import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { documentRefSchema } from "./target.ts";
import { ductsDocumentSchema } from "./ducts.ts";
import { fansDocumentSchema } from "./fans.ts";
import { ductFindingSchema, DUCT_INFERENCE_GRADES } from "./ducts-analysis.ts";
import { catalogTableSchema } from "./duct-catalog.ts";
import { fansReadRequest, fansReadResponse } from "./fans-read.ts";

export const ductsRosterArgs = z.object({ target: documentRefSchema });
export const ductsNetworkArgs = ductsRosterArgs.extend({
  system: z.union([z.literal("all"), z.array(z.string()).max(512)]),
});
export const ductsNetworkData = nativeResponseSchema("ducts.snapshot.walk").and(z.object({
  sourceVersion: z.string(),
  systemReads: z.object({ completed: z.array(z.number()), missing: z.array(z.number()) }),
}));
export const ductsRosterData = nativeResponseSchema("ducts.snapshot.roster").and(z.object({ sourceVersion: z.string() }));
const numberOrNull = z.number().nullable();
const record = <T extends z.ZodType>(schema: T) => z.record(z.string(), schema);
const flow = z.object({ cfm: numberOrNull, source: z.string().nullable(), grilles: z.number().optional(), finding: z.literal("no-flow").optional() });
const provisional = z.object({ worst: z.enum(DUCT_INFERENCE_GRADES), count: z.number(), findingIds: z.array(z.string()) }).nullable();
export const ductsPriceRow = z.object({
  id: z.number(), kind: z.enum(["friction", "fitting", "tap-branch", "tap-straight", "terminal"]),
  dp: numberOrNull, desc: z.string(), rule: z.string().optional(), table: z.string().optional(),
  c: z.number().optional(), pv: z.number().optional(), fpm: z.number().optional(),
  lengthFt: z.number().optional(), roughnessFt: z.number().optional(), rate: z.number().optional(),
  eqFt: numberOrNull.optional(), family: z.string().optional(), staticInWg: numberOrNull.optional(),
  revitDp: z.number().optional(), notes: z.array(z.string()).optional(), error: z.string().optional(),
}).catchall(z.json());
const path = z.object({ groupId: z.string(), total: z.number(), tel: z.number(), path: z.array(z.number()),
  rows: z.array(ductsPriceRow), inferred: z.array(z.string()), provisional });
const fan = z.object({ unit: z.number(), cfm: numberOrNull, port: numberOrNull, junction: numberOrNull,
  owned: z.array(z.number()), esp: z.number(), critical: numberOrNull, tel: numberOrNull,
  stretch: z.array(ductsPriceRow), viaJunction: z.boolean(), path: z.array(z.number()), rows: z.array(ductsPriceRow) });
const loss = z.object({
  // The circuit solver's complete evidence is retained as JSON; renderers need no circuit engine.
  design: z.json(), paths: record(path), fan: z.number(), critical: numberOrNull, provisional,
  byGroup: record(z.object({ fan: numberOrNull, critical: numberOrNull, criticalTel: numberOrNull,
    criticalFan: numberOrNull, revitCritical: numberOrNull, hasAirMover: z.boolean(), implausible: z.array(z.number()),
    provisional, fans: z.array(fan) })),
  byRule: record(z.object({ critical: z.number(), per: record(z.number()), instances: z.number() })),
  errors: z.array(z.object({ id: z.number(), rule: z.string().optional(), table: z.string().optional(), message: z.string() })),
  crossClass: z.array(z.object({ id: z.number(), from: z.number(), classification: z.string(), fromClassification: z.string(), cfm: z.number() })),
});
export const ductsPricingData = z.object({
  network: ductsNetworkData,
  ductsWork: ductsDocumentSchema, fansWork: fansDocumentSchema,
  catalogFindings: z.array(z.string()),
  priced: z.object({
    snapshot: nativeResponseSchema("ducts.snapshot.walk"), flows: record(flow), equipmentFlows: record(flow),
    fanFlows: record(record(flow)), roles: record(z.object({ role: z.enum(["fan", "passive"]), why: z.enum(["ruled", "edit", "proposed"]), reason: z.string() })),
    findings: z.array(ductFindingSchema), inferred: z.array(z.object({ between: z.tuple([z.number(), z.number()]), id: z.string(), grade: z.enum(DUCT_INFERENCE_GRADES), ruled: z.boolean() })),
    catalogs: record(catalogTableSchema), applied: record(z.string()), choices: record(z.string()),
    overrides: record(z.json()), now: loss, next: loss, edit: record(z.json()),
  }),
  ready: record(z.object({ level: z.enum(["blocked", "walkable", "budgetable"]), walk: z.array(z.string()), budget: z.array(z.string()) })),
  analysis: z.object({
    heal: z.object({
      groups: z.array(z.object({ group: z.string(), items: z.array(z.object({ key: z.string(), kind: z.enum(["cap", "join"]),
        how: z.enum(["cap", "connect", "union", "extend"]), end: z.string(), other: z.string().optional(), gapIn: z.number(), ids: z.array(z.number()), covers: z.array(z.string()) })) })),
      covered: z.array(z.string()), hard: record(z.object({ ids: z.array(z.number()), covers: z.array(z.string()), note: z.string() })),
    }),
    notes: record(z.object({ fix: z.number(), set: z.number() })),
    systems: z.array(z.object({ key: z.string(), name: z.string(), kind: z.literal("system"), groups: z.array(z.string()),
      classification: z.string().nullable(), sub: z.string(), rating: numberOrNull, total: numberOrNull, fanless: z.boolean(), blocked: z.boolean(),
    }).catchall(z.json())),
    inference: z.object({ joints: z.array(z.json()), taps: z.array(z.json()), inline: z.array(z.json()), findings: z.array(z.object({ id: z.string(), kind: z.string(), elementIds: z.array(z.number()), note: z.string(), grade: z.enum(DUCT_INFERENCE_GRADES).nullable() }).catchall(z.json())) }),
  }),
});
/** Same publication/Value protocol as Fans; only the semantic data and args vary. */
export const ductsReadRequest = fansReadRequest.omit({ args: true }).extend({
  read: z.enum(["ducts.roster", "ducts.network", "ducts.pricing"]), args: ductsNetworkArgs,
});
export const ductsReadResponse = fansReadResponse.extend({
  value: fansReadResponse.shape.value.unwrap().extend({ data: z.union([ductsRosterData, ductsNetworkData, ductsPricingData]) }).nullable(),
});
export type DuctsPricingData = z.infer<typeof ductsPricingData>;
