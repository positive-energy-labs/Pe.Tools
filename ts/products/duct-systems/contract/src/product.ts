import { z } from "zod";
import { listSearchSchema } from "@pe/agent-contracts";
import { product as define, type ProductCommand } from "@pe/agent-contracts/product";
import { picturePose, field, stageField, subjectSchema } from "@pe/agent-contracts/route";
import type { Many } from "@pe/agent-contracts/route-kernel-page";
import { subjectOf, type SubjectRefCode } from "@pe/agent-contracts/subject-ref";
import { workIntent, workWriteCommands } from "@pe/agent-contracts/write-intent";
import {
  DUCT_SYSTEMS_ROUTE,
  ductSystemCells,
  type DuctsRouteDocument,
} from "@pe/ducts-contract/system-work";
import { losses, product as base } from "@pe/ducts-contract/product";
import { fanScopeSchema, type FanScope } from "@pe/ducts-contract/fan-scope.neutral";
import { DUCTS_SYSTEM_MAX } from "./ducts-read.ts";
import * as reads from "./contract.ts";

const system = subjectSchema(DUCTS_SYSTEM_MAX);
const fields = {
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

const derive = (work: unknown): DuctsRouteDocument => product.work.schema.parse(work);
export const product = define({
  id: DUCT_SYSTEMS_ROUTE,
  toolName: "ducts",
  says: "Human and Pea edit shared Work at an expected revision. Duct pressure-drop Work, one shared cell per key; the fan-side cells (drops, flows, equipmentFlows, roles) are /fans Work. Design criteria are top-level cells, one per criterion and side (velocitySupplyFpm, velocityReturnFpm, terminalDropInWg, autoJoinGapIn, healBoxIn, splitPolicy even | proportional, allowanceSupplyInWg, allowanceReturnInWg), each served from staged Work first, then the project or firm setting, then the engine default. Design friction is a project and firm setting in Settings/ducts.json, never Work or written to Revit. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore), and a proximity:<...> finding id holds ignore (break that inferred join) or connect (confirm it, or join a near miss across air classifications anyway); a near-miss or stretched join is bridged by the route and final (a diagnostic, no verdict owed); only an anomalous join (reversed connector, part through its host, cross-class) leaves a result provisional until an author edits a verdict, and a suggested verdict never makes it final, so include the evidence for a suggested ruling in the note; flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. An ignore verdict (an open end left out, an inferred join objected to) is a ruling the model keeps in its _PE_DuctLosses store: ducts.snapshot store.verdicts are the standing rulings, Work holds only pending changes over them (a staged verdict prices while staged; a /duct-systems sheet.apply stores it), and either author removes a stored verdict with a delete edit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. ruleAssignments: a fitting family name no rule matches holds { rule }, the loss-rule key every fitting of that family is priced as (read before any rule's own match; stays in Pe, never written to Revit). catalogs: JSON.stringify([family, type]) (type \"\" = every type of the family) holds { table }, the manufacturer catalog table id; edited links beat the family TYPE Pe_Catalog parameter and stay in Work. The scene: subject is keyed by group id (the id from ducts.snapshot groups, g<lowest element id>), each cell holding the ordered element ids of that group's whole system as intended, end to end (outdoor intake or terminal through every element to the last equipment), including elements past a break; list every element in order, short stubs and transitions too, and never stop at the last connected element: the route draws breaks and omissions, so leave nothing out to avoid a gap. labelParameter is one cell naming the instance parameter whose value names equipment for people; absent it reads PE_G___TagInstance, the firm equipment tag (type counterpart PE_G___TagType), not the built-in Mark. workingPhase is one cell naming the phase the network is read in: suggest or edit the phase (a name in ducts.snapshot phases.order) that the snapshot's phases.views census shows in most views; the route leaves out every element that does not exist in it and warns out-of-phase where one touches the network. Fan inputs (flows, terminalDrops, componentDrops, equipmentFlows, roles) belong to /fans; edit them only there. /duct-systems owns rules, kinds, criteria, design friction and network rulings. A claim on an element, with its verdict, is a finding (findings.say), not ducts Work. Either author may edit rules, catalogs, the subject, the label parameter and the working phase; a /fans sheet.plan previews fitting coefficients for rules named in writeIntent.cells. The whole plan refuses unless the table for each named rule used by those fitting writes is saved in the model. Save the tables on /duct-systems first. A /fans sheet.apply writes the planned coefficients to elements and unit roles to the store. Rule tables and verdicts stay staged through it. A /duct-systems sheet.plan and sheet.apply (pass this route's Work handle) store every staged rule table and ignore verdict, remove a stored verdict staged for delete, and write no element. A capped or connect verdict over a stored ignore removes the stored one, and its cell stays staged.",
  work: {
    title: "Ducts",
    settingsOwners: ["ducts"],
    schemaVersion: 4,
    retired: ["ducts"],
    finds: [
      "duct",
      "duct-systems",
      "pressure drop",
      "pdrop",
      "static pressure",
      "esp",
      "fan",
      "system",
      "sa 19",
      "run",
      "ready",
      "open ends",
      "equipment tag",
    ],
  },
  homes: { settings: base.homes.settings, catalogs: base.homes.catalogs, losses },
  cells: ductSystemCells,
  sheetWrites: { route: "duct-systems", writes: { losses: ["rules", "assumptions"] } },
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

export const ductSystemsWork = product.work;
type DuctSystemCommands = typeof product.commands;
declare module "@pe/agent-contracts/handle" {
  interface ProductCommands extends DuctSystemCommands {}
}
