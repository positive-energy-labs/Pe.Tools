import { z } from "zod";
import { cell, product as declare, workSchema, type Cell } from "@pe/agent-contracts/product";
import {
  field,
  listFields,
  picturePose,
  stageField,
  subjectSchema,
} from "@pe/agent-contracts/route";
import { schemaOf, type Domain, type DomainValue } from "@pe/agent-contracts/slots/sheet";
import type { Immutable, RouteStatePatch } from "@pe/agent-contracts";
import { DUCT_UNIT_ROLES, elementSubjectRecord } from "@pe/ducts-contract/duct-inputs";
import { lossWrites, product as ducts } from "@pe/ducts-contract/product";
import { sheetCommands } from "@pe/ducts-contract/semantic-actions";
import { admissionPreflight } from "./admission.ts";
import { peaGuide } from "./pea/ducts-skill.ts";
import { contract } from "@pe/agent-contracts/handle";
import { publicationRequest, publicationSchema } from "@pe/agent-contracts/value";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsDocumentSchema, ductSlotSourcesSchema } from "@pe/ducts-contract/system-work";
import { subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import { settingTiersSchema } from "@pe/agent-contracts/tiered-setting";
import { documentRefSchema } from "@pe/agent-contracts/target";
import { CALC_READ, CALC_DETAIL_READ, CALC_BREAKDOWN_READ } from "./fan-calc.ts";
import { ductsBaseSchema } from "@pe/ducts-contract/duct-inputs";
import { catalogTableSchema } from "@pe/ducts-contract/duct-catalog";
import { ductsFanCalcSchema } from "./fan-calc-data.ts";
import {
  ductsRosterRequestSchema,
  ductsRosterResponseSchema,
  ductsCalcRequestSchema,
  ductsCalcOverviewSchema,
  ductsCalcResponseSchema,
} from "./calc-read.ts";

const cfm = { kind: "number", min: 0, unit: "cfm", digits: 0 } as const;
const esp = {
  kind: "object",
  fields: { inWg: { kind: "number", min: 0, unit: "in-wg", digits: 4 } },
} as const;
const drop = { ...esp, metadata: { source: z.string().optional() } };
const fanCells = {
  writeIntent: cell(
    {
      kind: "enum",
      shape: z.strictObject({
        walk: z.strictObject({ unitId: z.number().int(), portIndex: z.number().int() }).optional(),
      }),
      choices: [],
    },
    "route",
    { label: "Write scope" },
  ),
  roles: cell(
    {
      kind: "object",
      fields: {
        role: {
          kind: "enum",
          shape: z.enum(DUCT_UNIT_ROLES),
          choices: DUCT_UNIT_ROLES.map((value) => ({
            value,
            label: value === "fan" ? "Fan" : "Passive",
          })),
        },
      },
    },
    "subject",
  ),
  equipmentFlows: cell(cfm, "subject"),
  ratedEsp: cell(esp, "subject"),
  flows: cell(cfm, "subject"),
  terminalDrops: cell(drop, "subject"),
  componentDrops: cell(drop, "subject"),
};
export type FansWorkSchema = ReturnType<typeof workSchema<typeof fanCells>>;

const fansDesignSchema = z.lazy(
  (): z.ZodObject<FansWorkSchema["shape"] & typeof ductsDocumentSchema.shape> =>
    z.object({ ...product.work.schema.shape, ...ductsDocumentSchema.shape }),
);
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
export const fansReadArgs = z.strictObject({
  target: documentRefSchema,
  /** Fan ports as SubjectRef `UniqueId:<unit>#port:<n>` codes, decoded at this door. */
  fan: z.union([z.literal("all"), z.array(subjectRefCodeSchema)]),
  calcPath: z.string().default(""),
});
/** Explicit detail selections build one worksheet per port. */
export const FAN_DETAIL_LIMIT = 8;
export const fanDetailLimitMessage = `Open up to ${FAN_DETAIL_LIMIT} fan ports at a time from the roster.`;
export const fansReadRequest = publicationRequest(fansReadArgs);

export const fansCalcData = fanCalcSchema.extend({
  calcView: z.object({
    blockers: detail[4].shape.blockers,
    tiers: z.record(z.enum(["taken", "accept", "preview"]), z.number()),
    taken: z.array(z.string()),
    inputs: detail[4].shape.inputs.nullable(),
    firm: detail[4].shape.firm.nullable(),
  }),
  design: fansDesignSchema,
  /** Each owner's `Settings/<owner>.json` in every home tier, as the host read it: a `setting` cell's tiers (ADR 0037 rule 8). */
  settings: z.record(z.string(), settingTiersSchema),
  fans: ductsRosterResponseSchema,
  ductSystemsWork: ductsDocumentSchema,
  /** The /ducts Work revision this read priced with: the Fans sheet's read-only line to the design it depends on. */
  ductSystemsRevision: z.number().int().nonnegative(),
  fansWork: z.lazy((): FansWorkSchema => product.work.schema),
  calcSnapshot: z.union([
    nativeResponseSchema("ducts.snapshot.walk")
      .and(
        z.object({
          sourceVersion: z.string().optional(),
          slotSources: ductSlotSourcesSchema.optional(),
        }),
      )
      .refine(
        (snapshot) =>
          !snapshot.groups.some((group) => group.id === "sheet") &&
          !snapshot.nodes.some((node) => node.groupId === "sheet") &&
          !snapshot.segments.some((segment) => segment.groupId === "sheet"),
        "Retired calc group; capture this calculation again. Recording bytes were not changed.",
      ),
    z.object({ kind: z.literal("absent") }),
  ]),
});
export const fansReadResponse = publicationSchema(fansCalcData);

const pricingReads = ["ducts.snapshot.walk", "ducts.tables"] as const;
export const overview = contract("fans.pressures", {
  input: ductsRosterRequestSchema.pick({ target: true }),
  data: ductsRosterResponseSchema,
  uses: ["ducts.snapshot.roster", ...pricingReads],
  keyedBy: { rows: { kind: "UniqueId", sub: "port" } },
});
export const calcDetail = contract(CALC_DETAIL_READ, {
  input: ductsCalcRequestSchema,
  data: ductsCalcResponseSchema,
  uses: pricingReads,
});
export const calcBreakdown = contract(CALC_BREAKDOWN_READ, {
  input: ductsCalcRequestSchema,
  data: ductsCalcResponseSchema.options[3],
  uses: pricingReads,
});
export const calc = contract(CALC_READ, {
  input: fansReadArgs,
  data: fansCalcData,
  uses: [
    "ducts.snapshot.roster",
    "ducts.snapshot.walk",
    "ducts.tables",
    "revit.catalog.field-options",
  ],
  keyedBy: {
    rows: { kind: "UniqueId", sub: "port" },
    "fans.rows": { kind: "UniqueId", sub: "port" },
  },
});

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
    design: z.lazy(() => fansDesignSchema.unwrap().strict()),
    firm: ductsBaseSchema,
    revision: z.number(),
  }),
  data: z.array(ductsFanCalcSchema),
  uses: [],
});

const fan = subjectSchema(Number.MAX_SAFE_INTEGER);
const fields = {
  ...picturePose,
  fan: field(fan, { kind: "ids", ids: [] }, "subject", "push"),
  stage: stageField(["calc"]),
  ...listFields("input"),
  ...listFields("roster"),
  calcPath: field(z.string(), "", "query"),
};
export const fansPanes = {
  roster: "calc-roster",
  inputs: "calc-inputs",
  picture: "calc-picture",
  ledger: "calc-ledger",
} as const;
const roster = ["calc", () => ({ fan: [], calcPath: "" })] as const;
const writes = {
  losses: ["roles"],
  fittingResults: [],
  specificCoefficient: [],
  specificLoss: ["componentDrops"],
  requiredEsp: [],
  fanFlow: ["equipmentFlows"],
  terminalFlow: ["flows"],
  terminalDrop: ["terminalDrops"],
} as const satisfies Record<keyof typeof lossWrites, readonly string[]>;
const declaration = declare({
  id: "fans",
  says: "Inspect fan paths, inputs and pressure requirements",
  work: {
    title: "Fans",
    settingsOwners: ["ducts"],
    schemaVersion: 2,
    subjectRecord: elementSubjectRecord,
  },
  homes: ducts.homes,
  cells: fanCells,
  commands: {
    "sheet.plan": { ...sheetCommands["sheet.plan"], writes: {} },
    "sheet.apply": {
      ...sheetCommands["sheet.apply"],
      writes,
    },
  },
  readings: {
    calc: {
      handle: calc,
      sources: ["losses", "settings", "catalogs"],
      load: { slow: "Pricing fan paths", freshBy: ["document-mark"] },
      says: "Read fans.calc for the Fans worksheet.",
    },
    roster: {
      handle: fanRoster,
      sources: ["losses", "settings"],
      load: { slow: "Reading fan ports", freshBy: ["document-mark"] },
      says: "Use fans.roster with args {target, mark} to find a fan port by its mark.",
    },
    overview: {
      handle: overview,
      sources: ["losses", "settings", "catalogs"],
      load: { slow: "Pricing the fan roster", freshBy: ["document-mark"] },
      says: "Read fans.pressures for the required ESP and completeness of each fan port.",
    },
    calcDetail: {
      handle: calcDetail,
      sources: ["losses", "settings", "catalogs"],
      load: { slow: "Building fan detail", freshBy: ["document-mark"] },
      says: "Read fans.calc-detail for a pressure sheet.",
    },
    calcBreakdown: {
      handle: calcBreakdown,
      sources: ["losses", "settings", "catalogs"],
      load: { slow: "Building the fan worksheet", freshBy: ["document-mark"] },
    },
    networkCalcs: { handle: networkCalcs, sources: [] },
  },
  routes: {
    fans: {
      name: "Fans",
      directory: {
        aliases: ["fan", "ESP", "pressure"],
        exposure: "Main",
        group: "Calculate loads & airflow",
        icon: "Wind",
        label: "Fan ESP",
        listed: true,
        resume: "document",
        runtimeNeed: "Revit for model reads and writes",
        satellites: [],
        summary: "Inspect fan paths, inputs and pressure requirements",
        surfaces: { pwa: "full", tray: false, web: "full" },
      },
      fields,
      subject: { field: "fan", read: roster, noun: "fan", pane: fansPanes.roster },
      core: [
        "calc",
        (page: { fan: Immutable<z.output<typeof fan>>; calcPath: string }) => ({
          fan: page.fan.kind === "all" ? "all" : page.fan.ids,
          calcPath: page.calcPath,
        }),
      ],
      reads: { roster },
      panes: Object.values(fansPanes),
    },
  },
  guide: peaGuide,
});
// The shared sheet pair is published by Ducts; Work dispatch selects Fans' bodies.
const tool = { ...declaration.tool, commands: {} };
export const product = {
  ...declaration,
  tool,
  tools: { fans: tool },
  actions: {},
  admissionPreflight: admissionPreflight(declaration.work.schema),
};
export const fanWriteSegments = Object.values(writes).flat();

type SubjectCell = {
  [K in keyof typeof fanCells]: (typeof fanCells)[K]["per"] extends "subject" ? K : never;
}[keyof typeof fanCells];
type EditableValue<D extends Domain> = D extends {
  kind: "object";
  fields: infer F extends Readonly<Record<string, Domain>>;
}
  ? DomainValue<{ kind: "object"; fields: F }>
  : DomainValue<D>;
type EditShape = {
  [K in SubjectCell]: z.ZodOptional<
    ReturnType<
      typeof elementSubjectRecord<z.ZodType<EditableValue<(typeof fanCells)[K]["domain"]> | null>>
    >
  >;
};
function editShape(cells: typeof fanCells): EditShape;
function editShape(cells: Readonly<Record<string, Cell>>): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(cells).flatMap(([name, { per, domain }]) =>
      per === "subject"
        ? [
            [
              name,
              elementSubjectRecord(
                schemaOf(
                  domain.kind === "object" ? { kind: "object", fields: domain.fields } : domain,
                ).nullable(),
              ).optional(),
            ],
          ]
        : [],
    ),
  );
}
export const fansCalcEditsSchema = z.strictObject({
  ...editShape(fanCells),
  refs: z.record(z.string(), elementSubjectRecord(z.string().trim().min(1))).optional(),
});
export type FansCalcEdits = z.output<typeof fansCalcEditsSchema>;
export const fanEditPatches = ({ refs, ...edits }: FansCalcEdits): RouteStatePatch[] =>
  Object.entries(edits).flatMap(([field, rows]) =>
    Object.entries(rows ?? {}).map(([key, value]) =>
      value === null
        ? { path: [field, key] }
        : {
            path: [field, key, "edit"],
            value: { value, ...(refs?.[field]?.[key] && { ref: refs[field][key] }) },
          },
    ),
  );
