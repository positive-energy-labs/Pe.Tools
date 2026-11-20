import { z } from "zod";
import { listSearchSchema } from "@pe/agent-contracts";
import { cell, product as define, type ProductCommand } from "@pe/agent-contracts/product";
import { picturePose, field, stageField, subjectSchema } from "@pe/agent-contracts/route";
import type { Many } from "@pe/agent-contracts/route-kernel-page";
import { subjectOf, type SubjectRefCode } from "@pe/agent-contracts/subject-ref";
import { workIntent, workWriteCommands } from "@pe/agent-contracts/write-intent";
import { DUCTS_CRITERIA_CELLS, isCriteriaCell } from "@pe/ducts-contract/duct-inputs";
import { DUCT_SYSTEMS_ROUTE, ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { criterionCellLabel, losses, product as base } from "@pe/ducts-contract/product";
import { sheetCommands } from "@pe/ducts-contract/semantic-actions";
import { fanScopeSchema, type FanScope } from "@pe/ducts-contract/fan-scope.neutral";
import { DUCTS_SYSTEM_MAX } from "./ducts-read.ts";
import * as reads from "./contract.ts";
import { ductsRouteState as state } from "./ducts.ts";

const system = subjectSchema(DUCTS_SYSTEM_MAX);
export const fields = {
  ...picturePose,
  fan: field(fanScopeSchema.nullable(), null, "query"),
  system: field(system, { kind: "ids", ids: [] }, "subject", "push"),
  stage: stageField(["network"]),
  systemSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  systemSort: field(z.enum(["", "name", "loss"]), "", "query"),
  treeSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  treeSort: field(z.enum(["", "name"]), "", "query"),
  rulingSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  rulingSort: field(z.enum(["", "name", "status"]), "", "query"),
};
const args = ({ fan, system }: { fan: FanScope | null; system: Many<SubjectRefCode> }) => ({
  system: system.kind === "all" ? [] : system.ids.map((id) => String(subjectOf(id).key)),
  fan: system.kind === "ids" && system.ids.length === 0 ? fan : null,
});

// Both duct products consume the same persisted Work schema, including its named criteria
// group, deletable rulings and key validation. Read the domains from those validators.
const doc = ductsDocumentSchema.shape;
const value = <S extends z.ZodType, const P extends "route" | "name">(shape: S, per: P) =>
  cell({ kind: "enum", shape, choices: [] }, per);
const criterionCells = Object.fromEntries(
  Object.keys(DUCTS_CRITERIA_CELLS)
    .filter(isCriteriaCell)
    .map((name) => [
      `criteria.${name}`,
      cell(DUCTS_CRITERIA_CELLS[name].domain, "route", { label: criterionCellLabel(name) }),
    ]),
);
const cells = {
  ...criterionCells,
  writeIntent: value(doc.writeIntent.unwrap().shape.edit.unwrap().unwrap().shape.value, "route"),
  assumptions: value(
    doc.assumptions.unwrap().valueType.shape.edit.unwrap().unwrap().shape.value.unwrap(),
    "name",
  ),
  rules: value(doc.rules.unwrap().valueType.shape.edit.unwrap().unwrap().shape.value, "name"),
  catalogs: value(doc.catalogs.unwrap().valueType.shape.edit.unwrap().unwrap().shape.value, "name"),
  ruleAssignments: value(
    doc.ruleAssignments.unwrap().valueType.shape.edit.unwrap().unwrap().shape.value,
    "name",
  ),
  subject: value(doc.subject.unwrap().valueType.shape.edit.unwrap().unwrap().shape.value, "name"),
  labelParameter: value(
    doc.labelParameter.unwrap().shape.edit.unwrap().unwrap().shape.value,
    "route",
  ),
  workingPhase: value(doc.workingPhase.unwrap().shape.edit.unwrap().unwrap().shape.value, "route"),
  systemColours: value(
    doc.systemColours.unwrap().shape.edit.unwrap().unwrap().shape.value,
    "route",
  ),
  kinds: value(doc.kinds.unwrap().valueType.shape.edit.unwrap().unwrap().shape.value, "name"),
};

const action = <const N extends ProductCommand["native"], const E extends "query" | "command">(
  native: N,
  effect: E,
  says: string,
  dirties: ProductCommand["dirties"] = [],
) => ({
  native,
  effect,
  says,
  dirties,
  needs: "project-document" as const,
  input: z.strictObject({}),
  writes: {},
});
const walk = "ducts.snapshot.walk",
  roster = "ducts.snapshot.roster";
const actions = {
  "ducts.refresh": {
    ...action([], "query", "Read this document's duct snapshots and pricing inputs again.", [
      "snapshot",
    ]),
    catalogEffect: "Read",
  },
  "ducts.plan-heal": action(
    [walk, roster],
    "query",
    "Plan and seal the staged groups' repairs: cap dangling ends, connect coincident same-size ends, and close same-size gaps up to 3 in. Show the plan before apply.",
  ),
  "ducts.rehearse-heal": action(
    [walk, roster, "ducts.heal.preview"],
    "query",
    "Rehearse the repair and post-check in Revit, then roll back. Refuses workshared models. Apply still requires a plan.",
  ),
  "ducts.apply-heal": action(
    [walk, roster, "ducts.heal"],
    "command",
    "Apply the approved repairs, one transaction per group. Items failing Pe's post-check are refused and rolled back. Read the snapshot again for rebuilt element ids.",
    ["snapshot"],
  ),
  "ducts.plan-assign-fan": action(
    [walk],
    "query",
    "Plan making the staged unit the system's base equipment. Show the sealed plan before apply.",
  ),
  "ducts.rehearse-assign-fan": action(
    [walk, "ducts.assign-fan.preview"],
    "query",
    "Rehearse the fan assignment and read back, then roll back. Refuses workshared models, systems with base equipment, and equipment with no port of the system's classification. Apply still requires a plan.",
  ),
  "ducts.apply-assign-fan": action(
    [walk, "ducts.assign-fan"],
    "command",
    "Make the approved unit the system's base equipment. Read the snapshot again to confirm its role.",
    ["snapshot"],
  ),
} as const satisfies Record<string, ProductCommand>;

const derive = (work: unknown) => ductsDocumentSchema.parse(work);
const declarations = define({
  id: DUCT_SYSTEMS_ROUTE,
  says: state.description,
  homes: { settings: base.homes.settings, catalogs: base.homes.catalogs, losses },
  cells,
  readings: {
    overview: {
      handle: reads.overview,
      sources: ["settings", "losses"],
      load: { freshBy: ["document-mark"] },
    },
    roster: {
      handle: reads.roster,
      sources: ["settings", "losses"],
      load: { freshBy: ["document-mark"] },
    },
    network: {
      handle: reads.network,
      sources: ["settings", "losses"],
      load: { alone: true, freshBy: ["document-mark"], slow: "Walking the opened systems" },
    },
    pricing: {
      handle: reads.pricing,
      sources: ["settings", "catalogs", "losses"],
      load: { alone: true, freshBy: ["document-mark"], slow: "Pricing the opened systems" },
    },
  },
  commands: {
    "ducts.refresh": actions["ducts.refresh"],
    ...workWriteCommands(DUCT_SYSTEMS_ROUTE, "ducts.apply-heal", actions["ducts.apply-heal"], {
      derive,
      preview: { key: "ducts.plan-heal", definition: actions["ducts.plan-heal"] },
    }),
    // A rehearsal derives the same request from Work but is no plan: it carries no seal and cannot arm apply.
    ...workIntent(DUCT_SYSTEMS_ROUTE, "ducts.rehearse-heal", actions["ducts.rehearse-heal"], {
      derive,
    }),
    ...workIntent(
      DUCT_SYSTEMS_ROUTE,
      "ducts.rehearse-assign-fan",
      actions["ducts.rehearse-assign-fan"],
      { derive },
    ),
    ...workWriteCommands(
      DUCT_SYSTEMS_ROUTE,
      "ducts.apply-assign-fan",
      actions["ducts.apply-assign-fan"],
      {
        derive,
        preview: {
          key: "ducts.plan-assign-fan",
          definition: actions["ducts.plan-assign-fan"],
        },
      },
    ),
    "sheet.plan": { ...sheetCommands["sheet.plan"], writes: {} },
    "sheet.apply": {
      ...sheetCommands["sheet.apply"],
      writes: { losses: ["rules", "assumptions"] },
    },
  },
  routes: {
    [DUCT_SYSTEMS_ROUTE]: {
      name: "Ducts",
      directory: {
        group: "Calculate loads & airflow",
        summary: "Review duct systems, stage inputs and rulings, and plan writes to Revit",
        label: "Pressure drop",
        icon: "Wind",
        exposure: "Main",
        surfaces: { web: "full", pwa: "full", tray: false },
        aliases: ["duct", "pressure", "airflow", "systems"],
        runtimeNeed: "Revit for model reads and writes",
        listed: true,
        satellites: [],
        resume: "document",
      },
      fields,
      subject: { field: "system", noun: "system", pane: "e-systems", read: "overview" },
      reads: { roster: "overview", network: ["network", args] },
      core: ["pricing", args],
      panes: ["e-systems", "e-sidebar", "e-rules-all", "e-rules", "e-picture", "design", "e-inbox"],
    },
  },
});

const { "sheet.plan": _plan, "sheet.apply": _apply, ...commands } = declarations.commands;
export const ductSystemsWork = {
  ...state,
  editable: declarations.work.editable
    .filter(([key]) => !String(key).startsWith("criteria."))
    .map((path) => path.map(String))
    .concat([["criteria", "*"]]),
};
export const ductSystemsTool = { ...declarations.tool, work: ductSystemsWork, commands };
export const product = {
  ...declarations,
  work: ductSystemsWork,
  tool: ductSystemsTool,
  tools: { ducts: ductSystemsTool },
  actions: commands,
};

type DuctSystemCommands = typeof commands;
declare module "@pe/agent-contracts/handle" {
  interface ProductCommands extends DuctSystemCommands {}
}
