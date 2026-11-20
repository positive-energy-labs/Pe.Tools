import { nativeResponseDefinitionSchema } from "@pe/host-contracts/native-schemas";
import type { DuctsApplyPlan } from "@pe/host-contracts/generated";
import {
  DUCT_SYSTEMS_ROUTE,
  ductsDocumentSchema,
  type DuctsRouteDocument,
} from "@pe/ducts-contract/system-work";
import { z } from "zod";
import { uniqueIdSchema } from "@pe/agent-contracts";
import { cellPatches } from "@pe/agent-contracts/draft";
import type { FanIssue } from "@pe/fans-contract/fans-inputs";
import { criteriaLayer, criteriaMeta } from "@pe/ducts-contract/duct-inputs";

import type { Author } from "@pe/agent-contracts/draft";
import type { FansDocument } from "@pe/fans-contract/fans";
import { type RouteStateSpec } from "@pe/agent-contracts/route-state";

/** A deadhead has no encounter closer, so neither button nor staging can accept it. */
export function encounterPatches(
  issue: FanIssue,
  choice: "connect" | "ignore",
  doc: DuctsRouteDocument | null,
) {
  if (issue.closer.kind !== "encounter") throw Error("This encounter cannot be ruled");
  const e = issue.closer.encounter,
    key = `encounter:${e.elementId}:${e.connector}`;
  return cellPatches(["assumptions"], key, doc?.assumptions[key] ?? {}, {
    kind: "set",
    rung: { value: { kind: "verdict", verdict: choice } },
  });
}

/** What pricing reads: both Works' cells side by side (FANSPLIT Q4); ducts owns `writeIntent`. */
export type DuctsDesign = DuctsRouteDocument & FansDocument;
export const ductsDesign = (ducts: DuctsRouteDocument | null, fans: FansDocument): DuctsDesign => ({
  ...fans,
  ...(ducts ?? ductsDocumentSchema.parse({})),
});

/**
 * One staged cell as the resolver reads it (wave 2 amendment 2): the value, the caller the host
 * stamped (`by`), and the evidence the caller cited, else the cell's own location, which says where
 * the evidence lives and claims nothing more. A cell with no human or Pea stamp is not handed over
 * at all: the runtime sets such stored Work aside before it is read, and no author is ever invented.
 */
export type StagedCell<V> = { value: V; by: "human" | "pea"; ref: string } | InvalidStagedCell;
/** A stored cell the host could not read (`{ invalid: reason }`), at its Work location: handed on so the resolver blocks fallback (P-040). */
export type InvalidStagedCell = { invalid: string; ref: string };
const stagedOf = <V>(
  work: "fans" | "duct-systems",
  segment: string,
  cells: Record<
    string,
    { invalid?: string; edit?: { value?: V; by?: Author; ref?: string } | null } | undefined
  >,
) =>
  Object.fromEntries<StagedCell<V>>(
    Object.entries(cells).flatMap(([key, cell]): [string, StagedCell<V>][] => {
      if (cell?.invalid)
        return [[key, { invalid: cell.invalid, ref: `work:${work}/${segment}/${key}` }]];
      const edit = cell?.edit;
      return edit?.value === undefined || (edit.by !== "human" && edit.by !== "pea")
        ? []
        : [
            [
              key,
              {
                value: edit.value,
                by: edit.by,
                ref: edit.ref?.trim() ? edit.ref : `work:${work}/${segment}/${key}`,
              },
            ],
          ];
    }),
  );

/** Staged edits only, per segment, each as a `StagedCell`. */
export function stagedDucts(doc: DuctsRouteDocument | null, fans: FansDocument) {
  return {
    rules: stagedOf("duct-systems", "rules", doc?.rules ?? {}),
    criteria: criteriaLayer(doc?.criteria ?? {}),
    /** Who staged each criterion and its ref; without it a staged criterion has no author and cannot resolve. */
    criteriaMeta: criteriaMeta(doc?.criteria ?? {}),
    kinds: stagedOf("duct-systems", "kinds", doc?.kinds ?? {}),
    assumptions: stagedOf("duct-systems", "assumptions", doc?.assumptions ?? {}),
    catalogs: stagedOf("duct-systems", "catalogs", doc?.catalogs ?? {}),
    ruleAssignments: stagedOf("duct-systems", "ruleAssignments", doc?.ruleAssignments ?? {}),
    terminalDrops: stagedOf("fans", "terminalDrops", fans.terminalDrops),
    componentDrops: stagedOf("fans", "componentDrops", fans.componentDrops),
    ratedEsp: stagedOf("fans", "ratedEsp", fans.ratedEsp),
    equipmentFlows: stagedOf("fans", "equipmentFlows", fans.equipmentFlows),
    roles: stagedOf("fans", "roles", fans.roles),
    flows: stagedOf("fans", "flows", fans.flows),
    subject: stagedOf("duct-systems", "subject", doc?.subject ?? {}),
    labelParameter: doc?.labelParameter?.edit?.value ?? null,
    workingPhase: doc?.workingPhase?.edit?.value ?? null,
  };
}

/**
 * The staged values alone, per segment, for a reader that prices and never attributes: group
 * pricing and the survey, which phase 3 retires with the group write path. Departs from "every
 * consumer reads the cell" (wave 2 amendment 2) because those readers resolve no provenance; the
 * resolver, and anything that names an author, reads `stagedDucts`.
 */
export function stagedValues(doc: DuctsRouteDocument | null, fans: FansDocument) {
  // Every staged value, stamped or not: the model's stored rulings are laid under Work as cells no
  // caller wrote (`withStoredRulings`), and this reader prices them without naming anyone.
  const bare = <V>(cells: Record<string, { edit?: { value?: V } | null } | undefined>) =>
    Object.fromEntries(
      Object.entries(cells).flatMap(([key, cell]) =>
        cell?.edit?.value === undefined ? [] : [[key, cell.edit.value]],
      ),
    ) as Record<string, V>;
  return {
    ...stagedDucts(doc, fans),
    rules: bare(doc?.rules ?? {}),
    kinds: bare(doc?.kinds ?? {}),
    assumptions: bare(doc?.assumptions ?? {}),
    catalogs: bare(doc?.catalogs ?? {}),
    ruleAssignments: bare(doc?.ruleAssignments ?? {}),
    terminalDrops: bare(fans.terminalDrops),
    componentDrops: bare(fans.componentDrops),
    ratedEsp: bare(fans.ratedEsp),
    equipmentFlows: bare(fans.equipmentFlows),
    roles: bare(fans.roles),
    flows: bare(fans.flows),
    subject: bare(doc?.subject ?? {}),
  };
}

/**
 * The phase the route reads the network in: the staged edit, whoever wrote it; an edited null
 * reads every element.
 */
export const workingPhaseOf = (doc: DuctsRouteDocument | null) =>
  doc?.workingPhase?.edit?.value ?? null;

/**
 * What `sheet.plan` and `sheet.apply` send; the host calls the native
 * `ducts.apply.plan` (Read) or `ducts.apply` (ModelWrite). Mirrors the generated `DuctsApply.Req.Request` field for field (the web
 * test pins the two types to each other). Built by the web from the edited cells and Pe's own
 * lookup: one fitting row per instance of an edited rule under the rule's chosen table; the
 * equipment rows carry the complete claim, through the `requiredEsp` slot, and the flow rows the resolved
 * terminal flows (`terminalFlow` slot) and edited `equipmentFlows` (`fanFlow` slot).
 */
const optionalText = z.string().nullable().optional();
const elementKey = z
  .string()
  .refine((key) => uniqueIdSchema.safeParse(key).success, "Expected a Revit UniqueId");
const flowReceipts = z
  .record(
    elementKey,
    z.strictObject({
      cfm: z.number().nonnegative(),
      source: optionalText,
      appliedAt: z.string(),
      parameter: optionalText,
    }),
  )
  .optional();
const writeDrop = z.strictObject({
  id: z.number().int(),
  inWg: z.number().nonnegative(),
  source: optionalText,
});
const writeFlow = z.strictObject({
  slot: z.string().min(1).optional(),
  id: z.number().int(),
  cfm: z.number().nonnegative(),
  source: optionalText,
});
const slotsSchema = z
  .strictObject({
    /** R3: absent/null inherits; empty string is explicit none; otherwise the parameter name. */
    requiredEsp: z.string().trim().nullable().optional(),
    ratedEsp: z.string().trim().min(1).nullable().optional(),
    fanFlow: z.string().min(1).nullable().optional(),
    componentDrop: z.string().min(1).nullable().optional(),
    terminalDrop: optionalText,
    /** The fitting family's own coefficient parameter the Pe loss server reads (default Pe_C). */
    fittingCoefficient: z.string().min(1).nullable().optional(),
    /**
     * The terminal's design CFM parameter the snapshot reads and apply writes (default
     * PE_M_Grd_AirFlow); the built-in `Flow` is the connector's own flow.
     */
    terminalFlow: z.string().min(1).nullable().optional(),
  })
  .refine(
    (s) => !s.requiredEsp || s.requiredEsp.toLowerCase() !== s.ratedEsp?.toLowerCase(),
    "requiredEsp and ratedEsp name the same parameter",
  );
/** Pe server consumes host-priced leg results; Specific Coefficient freezes one export coefficient. */
export const DUCT_FITTING_METHODS = ["pe-server", "specific-coefficient"] as const;
export type DuctFittingMethod = (typeof DUCT_FITTING_METHODS)[number];
export const ownerBlobReplacementSchema =
  nativeResponseDefinitionSchema<DuctsApplyPlan.Res.OwnerBlobReplacement>(
    "ducts.apply.plan",
    "OwnerBlobReplacement",
  ).nullish();

export const ductsApplyInputSchema = z.strictObject({
  replacement: ownerBlobReplacementSchema,
  slots: slotsSchema.nullable().optional(),
  fittings: z.array(
    z
      .strictObject({
        id: z.number().int(),
        method: z.enum(DUCT_FITTING_METHODS),
        coefficient: z.number(),
        table: optionalText,
        inputs: optionalText,
        ruleKey: optionalText,
        results: z
          .array(
            z.strictObject({
              velocityPressureInWg: z.number().nonnegative(),
              coefficient: z.number(),
            }),
          )
          .min(1)
          .optional(),
      })
      .superRefine((fitting, ctx) => {
        if (fitting.method === "pe-server" && !fitting.results?.length)
          ctx.addIssue({
            code: "custom",
            path: ["results"],
            message: "Host-priced leg results are required",
          });
      }),
  ),
  terminals: z.array(writeDrop),
  components: z.array(writeDrop),
  equipment: z.array(
    z.strictObject({ id: z.number().int(), externalStaticInWg: z.number().nonnegative() }),
  ),
  /** Resolved design flow per terminal in a priced group, written to the TerminalFlow slot (instance). */
  terminalFlows: z.array(writeFlow),
  /** Staged unit design flow, written to the FanFlow slot (instance first, then type). */
  equipmentFlows: z.array(writeFlow),
  /**
   * This apply's store entries (`DuctLossStore` v3). The native op overlays them per key on the
   * model's store (K3): a key omitted here keeps its stored entry; provenance records only writes
   * that land. `workRevision` is the model store's revision as read; an older one refuses as stale.
   */
  store: z.looseObject({
    /** Stored envelope version. Its five element maps use Revit UniqueId keys. */
    version: z.number().int().optional(),
    rules: z.record(z.string(), z.strictObject({ table: optionalText })).optional(),
    instances: z
      .record(
        elementKey,
        z.strictObject({
          table: optionalText,
          inputs: optionalText,
          coefficient: z.number(),
          appliedAt: z.string(),
        }),
      )
      .optional(),
    terminals: z
      .record(
        elementKey,
        z.strictObject({
          inWg: z.number().nonnegative(),
          source: optionalText,
          appliedAt: z.string(),
        }),
      )
      .optional(),
    terminalFlows: flowReceipts,
    equipmentFlows: flowReceipts,
    /** The rulings after this apply: `ignore` verdicts by issue or finding id (`rulings.ts`). */
    verdicts: z
      .record(z.string(), z.strictObject({ verdict: z.string().min(1), ruledAt: z.string() }))
      .optional(),
    /** Unit roles (`fan` or `passive`) a person ruled, by Revit UniqueId. */
    roles: z
      .record(elementKey, z.strictObject({ role: z.string().min(1), ruledAt: z.string() }))
      .optional(),
    slots: slotsSchema.nullable().optional(),
    workRevision: z.number().int().nonnegative().optional(),
    appliedAt: optionalText,
  }),
  /** Stored keys this apply removes; omission never deletes (native `DuctStoreDeletes`). */
  storeDeletes: z
    .strictObject({
      rules: z.array(z.string()).optional(),
      instances: z.array(elementKey).optional(),
      terminals: z.array(elementKey).optional(),
      terminalFlows: z.array(elementKey).optional(),
      equipmentFlows: z.array(elementKey).optional(),
      verdicts: z.array(z.string()).optional(),
      roles: z.array(elementKey).optional(),
    })
    .optional(),
});
export type DuctsApplyInput = z.infer<typeof ductsApplyInputSchema>;

/**
 * What `ducts.plan-heal` seals and `ducts.apply-heal` sends; `ducts.rehearse-heal` calls the native
 * `ducts.heal.preview`, apply `ducts.heal` (`DuctsHeal.Req.Request`); the plan calls neither. Each group is one transaction on apply. A group's
 * items are the route's Heal row (ducts-domain `heal.ts`), keys `elementId:connectorIndex`; a group
 * sent without items is planned by the host from a fresh snapshot with the same classifier, so an
 * agent names the group and reads the plan back.
 */
const connectorKey = z.string().regex(/^\d+:\d+$/);
export const ductsHealInputSchema = z.strictObject({
  groups: z
    .array(
      z.strictObject({
        group: z.string().min(1),
        items: z
          .array(
            z.strictObject({
              key: z.string().min(1),
              kind: z.enum(["cap", "join"]),
              end: connectorKey,
              other: connectorKey.optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});

/**
 * What `ducts.plan-assign-fan` seals and `ducts.apply-assign-fan` sends; `ducts.rehearse-assign-fan` calls the native
 * `ducts.assign-fan.preview`, apply `ducts.assign-fan` (`DuctsAssignFan.Req.Request`): make the unit the base equipment
 * of the Revit system (`ducts.snapshot` systems[].id and an equipment node id).
 */
export const ductsAssignFanInputSchema = z.strictObject({
  systemId: z.number().int().positive(),
  unitId: z.number().int().positive(),
});

/** What a person says when they want the Ducts page: the whole route family answers to these words. */
export const DUCTS_FINDS = [
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
] as const;

export const ductsRouteState = {
  schemaVersion: 3,
  route: DUCT_SYSTEMS_ROUTE,
  retired: ["ducts"],
  settingsOwners: ["ducts"],
  title: "Ducts",
  description:
    "Human and Pea edit shared Work at an expected revision. Duct pressure-drop Work, one shared cell per key; the fan-side cells (drops, flows, equipmentFlows, roles) are /fans Work. criteria: one cell per criterion and side (velocitySupplyFpm, velocityReturnFpm, terminalDropInWg, autoJoinGapIn, healBoxIn, splitPolicy even | proportional, allowanceSupplyInWg, allowanceReturnInWg), each served from staged Work first, then the project or firm setting, then the engine default. Design friction is a project and firm setting in Settings/ducts.json, never Work or written to Revit. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore), and a proximity:<...> finding id holds ignore (break that inferred join) or connect (confirm it, or join a near miss across air classifications anyway); a near-miss or stretched join is bridged by the route and final (a diagnostic, no verdict owed); only an anomalous join (reversed connector, part through its host, cross-class) leaves a result provisional until an author edits a verdict, and a suggested verdict never makes it final, so include the evidence for a suggested ruling in the note; flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. An ignore verdict (an open end left out, an inferred join objected to) is a ruling the model keeps in its _PE_DuctLosses store: ducts.snapshot store.verdicts are the standing rulings, Work holds only pending changes over them (a staged verdict prices while staged; a /duct-systems sheet.apply stores it), and either author removes a stored verdict with a delete edit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. ruleAssignments: a fitting family name no rule matches holds { rule }, the loss-rule key every fitting of that family is priced as (read before any rule's own match; stays in Pe, never written to Revit). catalogs: JSON.stringify([family, type]) (type \"\" = every type of the family) holds { table }, the manufacturer catalog table id; edited links beat the family TYPE Pe_Catalog parameter and stay in Work. The scene: subject is keyed by group id (the id from ducts.snapshot groups, g<lowest element id>), each cell holding the ordered element ids of that group's whole system as intended, end to end (outdoor intake or terminal through every element to the last equipment), including elements past a break; list every element in order, short stubs and transitions too, and never stop at the last connected element: the route draws breaks and omissions, so leave nothing out to avoid a gap. labelParameter is one cell naming the instance parameter whose value names equipment for people; absent it reads PE_G___TagInstance, the firm equipment tag (type counterpart PE_G___TagType), not the built-in Mark. workingPhase is one cell naming the phase the network is read in: suggest or edit the phase (a name in ducts.snapshot phases.order) that the snapshot's phases.views census shows in most views; the route leaves out every element that does not exist in it and warns out-of-phase where one touches the network. Fan inputs (flows, terminalDrops, componentDrops, equipmentFlows, roles) belong to /fans; edit them only there. /duct-systems owns rules, kinds, criteria, design friction and network rulings. A claim on an element, with its verdict, is a finding (findings.say), not ducts Work. Either author may edit rules, catalogs, the subject, the label parameter and the working phase; a /fans sheet.plan previews fitting coefficients for rules named in writeIntent.cells. The whole plan refuses unless the table for each named rule used by those fitting writes is saved in the model. Save the tables on /duct-systems first. A /fans sheet.apply writes the planned coefficients to elements and unit roles to the store. Rule tables and verdicts stay staged through it. A /duct-systems sheet.plan and sheet.apply (pass this route's Work handle) store every staged rule table and ignore verdict, remove a stored verdict staged for delete, and write no element. A capped or connect verdict over a stored ignore removes the stored one, and its cell stays staged.",
  schema: ductsDocumentSchema,
  finds: DUCTS_FINDS,
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
