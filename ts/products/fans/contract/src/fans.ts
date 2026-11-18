/** /fans Work (FANSPLIT, routes LEDGER 2026-11-03): the fan-side cells, split out of the ducts Work. */
import { z } from "zod";
import type { Immutable } from "@pe/agent-contracts/route-kernel-data";
import { draftCellSchema } from "@pe/agent-contracts/draft";
import type { RouteStateSpec } from "@pe/agent-contracts/route-state";
import { FAN_CELLS } from "./fans-inputs.ts";
import { schemaOf, type Domain } from "@pe/agent-contracts/slots/sheet";
import { elementSubjectSchema } from "@pe/ducts-contract/duct-inputs";
export { DUCT_UNIT_ROLES } from "@pe/ducts-contract/duct-inputs";

const dropSchema = z.strictObject({
  inWg: schemaOf(FAN_CELLS.terminalDrops.domain.fields.inWg),
  /** Where the number came from: a catalog page, a submittal, "rule of thumb". */
  source: z.string().optional(),
});
export type DuctDrop = z.infer<typeof dropSchema>;
/** Whether an air mover moves air (`fan`) or only sits in the path with a loss (`passive`). */
export type DuctUnitRole = z.infer<ReturnType<typeof schemaOf<typeof FAN_CELLS.roles.domain>>>;
/** One Work segment of a table row: a staged cell per element, decoded by the row's own domain. */
const cells = <const D extends Domain>(row: { readonly domain: D }) => z.record(elementSubjectSchema, draftCellSchema(schemaOf(row.domain))).default({});
/** Stated airflow in CFM; the cell's ref cites its evidence. */
export type { DuctFlow } from "@pe/ducts-contract/duct-inputs";

export const fansDocumentSchema = z.strictObject({
  /** Authored scope for the fan walk's loss preview and apply; never a native request. */
  writeIntent: draftCellSchema(
    z.strictObject({
      walk: z.strictObject({ unitId: z.number().int(), portIndex: z.number().int() }).optional(),
    }),
  ).default({}),
  terminalDrops: z.record(elementSubjectSchema, draftCellSchema(dropSchema)).default({}),
  componentDrops: z.record(elementSubjectSchema, draftCellSchema(dropSchema)).default({}),
  /** The ESP a fan is rated for, stated by a person or Pea; stays in Work, never written to Revit. */
  ratedEsp: cells(FAN_CELLS.ratedEsp),
  /** A unit's design flow (air mover id), written to the FanFlow slot; beats Revit's fanFlow fact. */
  equipmentFlows: cells(FAN_CELLS.equipmentFlows),
  /** Whether an air mover is a fan or a passive part; keyed by the unit's UniqueId SubjectRef. */
  roles: cells(FAN_CELLS.roles),
  flows: cells(FAN_CELLS.flows),
}).describe("/fans owns flows, terminalDrops, componentDrops, ratedEsp, equipmentFlows, roles. Parameter slot names are project and firm settings in Settings/ducts.json. /ducts owns rules, kinds, criteria, design friction and network rulings; read their cells in Values and edit through the owning /ducts Work. Fan-side Work, one shared cell per key; human and Pea edit it at an expected revision. terminalDrops and componentDrops: an UniqueId SubjectRef holds { inWg, source }. Required ESP comes only from the complete fan claim and writes through RequiredEsp; it has no Work cell. ratedEsp: an air mover's UniqueId SubjectRef holds { inWg }, the ESP the fan is rated for as stated (cite the submittal or schedule in the cell ref); it is a stated source of rated ESP, stays in Work and is never written to Revit. equipmentFlows: an air mover's UniqueId SubjectRef holds a plain CFM number, with evidence cited by the cell ref, the unit's design flow written to its FanFlow slot; it beats Revit's fanFlow fact. roles: an air mover's UniqueId SubjectRef holds { role: fan | passive }; a passive part adds a loss and moves no air, a fan is what a group needs to price. Unruled, a unit is proposed fan when it is base equipment of a Revit system its groups carry, else when it has airflow in the FanFlow slot; passive only when every duct port carries one classification and another unit moves air in its network; else fan. A unit role is a ruling the model keeps in its _PE_DuctLosses store once written: Work holds only the pending change. A fan with no stated flow reads the sum of the terminal flows it serves (derived, never written). flows: a terminal's UniqueId SubjectRef holds a plain CFM number, with evidence cited by the cell ref; it beats every other source. Otherwise a terminal reads the project's one terminal-flow slot: the slot a project or firm setting names, else the candidate (the default parameter or Revit Flow) that covers the most terminals; a terminal with no value in that slot is unpriced, never filled from another parameter. Apply writes the resolved terminal flow to that slot. Settings/ducts.json parameters: requiredEsp, ratedEsp, fanFlow, componentDrop, terminalDrop, fittingCoefficient, terminalFlow name the Revit parameter of each slot; terminalFlow and fanFlow are walk steps over ducts.snapshot airflowCandidates and fanFlowCandidates. writeIntent holds the fan walk { unitId, portIndex } from route:reads.value (read fans.roster). Its write targets are the current staged fan cells in that walk, derived at Plan and Apply.");
export type FansRouteDocument = z.infer<typeof fansDocumentSchema>;
/** Fan cells read by domain pricing; each route retains its own writeIntent. */
export type FansDocument = Immutable<Omit<FansRouteDocument, "writeIntent">>;

/** The fans Work no person has written: what a reader with no fans Work yet prices with. */
export const neutralFansWork: FansRouteDocument = fansDocumentSchema.parse({});

/**
 * The /fans Work spec, declared once here because contracts' own consumers (`semantic-actions.ts`)
 * read it; `fans/route.ts` names it as its Work, so the host registry binds this same object.
 */
export const fansRouteState = {
  route: "fans",
  settingsOwners: ["ducts"],
  title: "Fans",
  description: fansDocumentSchema.description ?? "Inspect fan paths, inputs and pressure requirements",
  schema: fansDocumentSchema,
  schemaVersion: 2,
} satisfies RouteStateSpec<typeof fansDocumentSchema>;
