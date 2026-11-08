/**
 * /fans Work (FANSPLIT, routes LEDGER 2026-11-03): the fan-side cells, split out of the ducts Work.
 * Every segment is a family of cells with one staged edit each:
 * - `terminalDrops` (terminal id) and `componentDrops` (fitting or accessory id): a stated drop in
 *   in-wg and where it came from.
 * - `esp` (air mover id): the external static Pe writes to a unit, in in-wg.
 * - `equipmentFlows` (air mover id): a stated design flow in cfm for the unit, written to its FanFlow slot.
 * - `roles` (air mover id): whether the unit is a `fan` or a `passive` part. Without a ruling the
 *   route proposes one (ducts-domain `unit-roles.ts`); a ruling is kept in the model's store (v2
 *   `roles`) and Work holds only the pending delta.
 * - `flows` (terminal id): a stated design flow in cfm that beats every other source.
 * - `parameters`: which Revit parameter carries each slot.
 * - `calculation`: calculation-only witnesses (`ductCalculationSchema`), never native apply.
 * - `designFriction`: the design friction rate in in-wg per 100 ft.
 */
import { z } from "zod";
import type { Immutable } from "./route-kernel-data.ts";
import { DUCT_PARAMETER_KEYS, ductCalculationSchema } from "./ducts.ts";
import { draftCellSchema } from "./draft.ts";

const dropSchema = z.strictObject({
  inWg: z.number().nonnegative(),
  /** Where the number came from: a catalog page, a submittal, "rule of thumb". */
  source: z.string().optional(),
});
export type DuctDrop = z.infer<typeof dropSchema>;
/** The external static Pe writes to an air mover (a unit id key); staged only, never a side effect. */
const espSchema = z.strictObject({ inWg: z.number().nonnegative() });
export const DUCT_UNIT_ROLES = ["fan", "passive"] as const;
/** Whether an air mover moves air (`fan`) or only sits in the path with a loss (`passive`). */
const roleSchema = z.strictObject({ role: z.enum(DUCT_UNIT_ROLES) });
export type DuctUnitRole = z.infer<typeof roleSchema>;
const elementKey = z.string().regex(/^\d+$/, { error: "a drop cell key is an element id" });
/** A stated design flow; `source` says where (a balancing report, a note, a person). */
const flowSchema = z.strictObject({ cfm: z.number().nonnegative(), source: z.string().optional() });
export type DuctFlow = z.infer<typeof flowSchema>;

export const fansDocumentSchema = z.strictObject({
  /** Authored scope for the fan walk's loss preview and apply; never a native request. */
  writeIntent: draftCellSchema(
    z.strictObject({
      walk: z.strictObject({ unitId: z.number().int(), portIndex: z.number().int() }).optional(),
    }),
  ).default({}),
  calculation: z.record(z.string().min(1), draftCellSchema(ductCalculationSchema)).default({}),
  terminalDrops: z.record(elementKey, draftCellSchema(dropSchema)).default({}),
  componentDrops: z.record(elementKey, draftCellSchema(dropSchema)).default({}),
  esp: z.record(elementKey, draftCellSchema(espSchema)).default({}),
  /** A unit's design flow (air mover id), written to the FanFlow slot; beats Revit's fanFlow fact. */
  equipmentFlows: z.record(elementKey, draftCellSchema(flowSchema)).default({}),
  /** Whether an air mover is a fan or a passive part; keyed by the unit's element id. */
  roles: z.record(elementKey, draftCellSchema(roleSchema)).default({}),
  flows: z.record(elementKey, draftCellSchema(flowSchema)).default({}),
  parameters: z
    .partialRecord(z.enum(DUCT_PARAMETER_KEYS), draftCellSchema(z.string().min(1)))
    .default({}),
  /**
   * The design friction rate, in-wg per 100 ft: the one rate the route reads each run against and
   * the fallback a part with no duct on its path is read at. A firm-authored Manual D rate; Revit never receives it.
   */
  designFriction: draftCellSchema(z.number().positive()).default({}),
}).describe("/fans owns calculation, flows, terminalDrops, componentDrops, esp, equipmentFlows, roles, parameters and designFriction. /ducts owns rules, kinds, criteria and network rulings; read their cells in Values and edit through the owning /ducts Work. Fan-side Work, one shared cell per key; human and Pea edit it at an expected revision. terminalDrops and componentDrops: an element id holds { inWg, source }. esp: an air mover's element id holds { inWg }, the external static written to it (FanStatic slot). equipmentFlows: an air mover's element id holds { cfm, source }, the unit's design flow written to its FanFlow slot; it beats Revit's fanFlow fact. roles: an air mover's element id holds { role: fan | passive }; a passive part adds a loss and moves no air, a fan is what a group needs to price. Unruled, a unit is proposed fan when it is base equipment of a Revit system its groups carry, else when it has airflow in the FanFlow slot; passive only when every duct port carries one classification and another unit moves air in its network; else fan. A unit role is a ruling the model keeps in its _PE_DuctLosses store once written: Work holds only the pending change. A fan with no stated flow reads the sum of the terminal flows it serves (derived, never written). flows: a terminal id holds { cfm, source }, a design flow that beats every other source (precedence: edited flow, then the rooms split when the rooms route supplies one, then Revit's own flow); apply writes the resolved terminal flow to the terminal's TerminalFlow slot. parameters: fanStatic, fanFlow, componentDrop, terminalDrop, fittingCoefficient, terminalFlow name the Revit parameter of each slot (authored); terminalFlow and fanFlow are walk steps over ducts.snapshot airflowCandidates and fanFlowCandidates. designFriction is one cell: the design friction rate in in-wg per 100 ft (default 0.08), never written to Revit. calculation: edit-only physical port witnesses and design scenarios; evidence is calculation-only, never native apply. writeIntent holds the fan walk { unitId, portIndex } from route:reads.value (read fans.roster). Its write targets are the current staged fan cells in that walk, derived at Plan and Apply.");
export type FansRouteDocument = z.infer<typeof fansDocumentSchema>;
/** Fan cells read by domain pricing; each route retains its own writeIntent. */
export type FansDocument = Immutable<Omit<FansRouteDocument, "writeIntent">>;

/** The fans Work no person has written: what a reader with no fans Work yet prices with. */
export const neutralFansWork: FansRouteDocument = fansDocumentSchema.parse({});
