import { fanLabel } from "../ducts/sheet/model.ts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { withWorkOwner } from "../../../../packages/agent-contracts/src/route-work-owner.ts";
import {
  ductsData,
  schemas as ownerSchemas,
  entries,
  neutralBodies,
  localId,
} from "../ducts/neutral.ts";

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
  panes: {
    "sheet-roster": {
      label: "Fans",
      purpose: "Open fan ports",
      draws: ["fans", "sheet", "sheetSnapshot", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-roster",
    },
    "sheet-inputs": {
      label: "Inputs",
      purpose: "Edit fan inputs",
      draws: ["fans", "sheet", "sheetSnapshot", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-inputs",
    },
    "sheet-picture": {
      label: "Picture",
      purpose: "Inspect fan paths",
      draws: ["fans", "sheet", "sheetSnapshot", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "sheet-picture",
    },
    "sheet-ledger": {
      label: "Ledger",
      purpose: "Inspect ESP and provenance",
      draws: ["fans", "sheet", "sheetSnapshot", "meshes"],
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
export const schemas = withWorkOwner(ownerSchemas, { data: ductsData, schemas: ownerSchemas });
const {
  pickSystems: _pickSystems,
  ...shared
} = neutralBodies;
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
export const fansHostModule = { data: fansData, schemas: ownerSchemas, bodies: {} };
