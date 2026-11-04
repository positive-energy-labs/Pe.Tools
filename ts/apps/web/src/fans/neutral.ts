import { emptyListSearch,listSearchSchema } from "@pe/agent-contracts";
import { z } from "zod";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { withWorkOwner } from "../../../../packages/agent-contracts/src/route-work-owner.ts";
import {
ductsData,
entries,
localId,
neutralBodies,openSheetSchema,schemas as ownerSchemas
} from "../ducts/neutral.ts";
import { fanLabel,TIERS } from "../ducts/sheet/model.ts";

const {
  cardinality: _cardinality,
  identity: _identity,
  picker: _picker,
  ...system
} = ductsData.fields.system;
export const fansData = {
  ...ductsData,
  key: "fans",
  address: "/fans",
  name: "Fans",
  directory: {
    ...ductsData.directory,
    label: "Fan ESP",
    summary: "Inspect fan paths, inputs and pressure requirements",
    aliases: ["fan", "ESP", "pressure"],
  },
  fields: {
    ...ductsData.fields,
    rosterSearch: {
      role: "query",
      schema: "rosterSearch",
      codec: "rosterSearch",
      initial: emptyListSearch(),
      url: "replace",
      share: true,
      agent: "set",
    },
    rosterSort: {
      role: "query",
      schema: "rosterSort",
      codec: "rosterSort",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    stage: { ...ductsData.fields.stage, initial: "sheet", schema: "sheetStage" },
    system: { ...system, role: "query" },
    fan: {
      ...ductsData.fields.fan,
      role: "subject",
      cardinality: "many",
      identity: "fan",
      picker: { reading: "fans", options: "pickFans" },
    },
  },
  subject: { field: "fan", noun: "fan", roster: "fans", detail: "sheet", pane: "sheet-roster" },
  work: { route: "ducts" },
  verbs: {
    ...ductsData.verbs,
    browse: {
      ...ductsData.verbs.browse,
      fields: [...ductsData.verbs.browse.fields, "rosterSearch", "rosterSort"],
    },
  },
  readings: {
    ...ductsData.readings,
    sheetView: {
      kind: "derive",
      output: "sheetView",
      derive: "sheetView",
      deps: { page: [], work: [], readings: ["sheet"] },
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "dependencies",
    },
  },
  panes: {
    "sheet-roster": {
      label: "Fans",
      purpose: "Open fan ports",
      draws: ["fans", "sheet", "sheetSnapshot"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-roster",
    },
    "sheet-inputs": {
      label: "Inputs",
      purpose: "Edit fan inputs",
      draws: ["fans", "sheet", "sheetSnapshot", "sheetView"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-inputs",
    },
    "sheet-picture": {
      label: "Picture",
      purpose: "Inspect fan paths",
      draws: ["fans", "sheet", "sheetSnapshot", "sheetView"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-picture",
    },
    "sheet-ledger": {
      label: "Ledger",
      purpose: "Inspect ESP and provenance",
      draws: ["fans", "sheet", "sheetSnapshot", "sheetView"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-ledger",
    },
  },
  layout: {
    kind: "split",
    id: "sheet-layout",
    axis: "h",
    sized: "start",
    size: 420,
    minSize: 280,
    minOtherSize: 360,
    rails: { start: { title: "Fans" } },
    children: [
      {
        kind: "split",
        id: "sheet-side",
        axis: "v",
        sized: "end",
        size: 360,
        children: [
          { kind: "pane", id: "sheet-roster" },
          { kind: "pane", id: "sheet-inputs" },
        ],
      },
      {
        kind: "split",
        id: "sheet-main",
        axis: "v",
        sized: "start",
        size: 360,
        children: [
          { kind: "pane", id: "sheet-picture" },
          { kind: "pane", id: "sheet-ledger" },
        ],
      },
    ],
  },
  stages: {
    sheet: {
      word: "Pricing fans",
      panes: ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"],
      verbs: ["losses"],
    },
  },
  stageOrder: ["sheet"],
} as const satisfies RouteGraphJson;
const rosterSort = z.enum(["", "name"]);
const fanSchemas = {
  ...ownerSchemas,
  sheetView: z.object({
    blockers: openSheetSchema.shape.inputs.unwrap().shape.blockers,
    tiers: z.record(z.enum(TIERS), z.number().int().nonnegative()),
    taken: z.array(z.string()),
    inputs: openSheetSchema.shape.inputs.unwrap().shape.inputs.nullable(),
    firm: openSheetSchema.shape.inputs.unwrap().shape.firm.nullable(),
  }),
  rosterSearch: listSearchSchema,
  rosterSort,
  browse: ownerSchemas.browse.extend({
    rosterSearch: listSearchSchema.optional(),
    rosterSort: rosterSort.optional(),
  }),
};
export const schemas = withWorkOwner(fanSchemas, { data: ductsData, schemas: ownerSchemas });
const { pickSystems: _pickSystems, dropFanCells: _dropFanCells, ...shared } = neutralBodies;
export const fansNeutralBodies = {
  ...shared,
  pickFans: {
    slot: "fields.fan.picker.options",
    kind: "picker",
    source: { module: "fans/neutral.ts", export: "fansNeutralBodies" },
    run: (reading) =>
      (reading.value?.rows ?? []).map((row) => ({
        id: localId("ducts-fan", `${row.uniqueId}@${row.portIndex}`),
        label: fanLabel(row, reading.value?.rows ?? []),
      })),
  },
} satisfies Omit<
  BodyBindings<typeof fansData, typeof schemas, typeof entries>,
  | "price"
  | "sheetView"
  | "sheet-roster"
  | "sheet-inputs"
  | "sheet-picture"
  | "sheet-ledger"
  | "presentLosses"
  | "presentHeal"
  | "presentFan"
  | "seedScene"
  | "seedLayout"
  | "seedColours"
  | "seedNavigation"
>;
export { entries };
export const fansHostModule = { data: fansData, schemas: fanSchemas, bodies: {} };
