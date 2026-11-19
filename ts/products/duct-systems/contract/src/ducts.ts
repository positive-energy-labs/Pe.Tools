/**
 * /ducts Work, every segment a family of cells with one staged edit each. The
 * fan-side cells live in the /fans Work (`fans.ts`, FANSPLIT); pricing reads both (`ductsDesign`).
 * - `assumptions`, keyed by what the assumption is about: an issue id from the snapshot
 *   (`open-end:g123:456:1`) holds a verdict; `flex-roughness:<flex type>`,
 *   `fan-static:<equipment id>`, `component-drop:<family>` hold overrides. An `ignore` verdict is a
 *   ruling the model keeps (`_PE_DuctLosses` v2 `verdicts`, ducts-domain `rulings.ts`): Work holds
 *   only the pending delta over the stored one, and a delete edit takes it back.
 * - `rules`: loss-rule key (the web's `LOSS_RULES`) -> the ASHRAE table every instance of the rule
 *   is re-looked-up under. Either author edits a type's table, never a raw coefficient.
 * - The scene (pressure-drop ledger, 2026-10-19): `subject`, keyed by group id, each cell an ORDERED
 *   element-id list; `labelParameter`, one cell naming the instance parameter whose value names
 *   equipment for people (`ducts.snapshot` reads it into `DuctNode.label`). Either author stages
 *   both. A claim with a verdict is a finding (ADR 0035 rule 9), not ducts Work.
 * - `workingPhase` (kaitpw 2026-10-19), one cell naming the phase the firm's views show (a name in
 *   the snapshot's `phases.order`); either author stages it from the snapshot's view
 *   census, and the route leaves out every element that does not exist in it (`phases.ts`).
 * `ducts.apply` runs from two doors (D9). /fans writes the fitting coefficients of the rules named in `writeIntent.cells`,
 * the fans Work's drops, flows, complete-claim ESP and slots to Revit, and roles to the store. /duct-systems stores its
 * staged rule tables and verdicts and writes no element.
 */
import { decode, subjectOf, subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import { z } from "zod";
import { cellPatches } from "@pe/agent-contracts/draft";
import type { FanIssue } from "@pe/fans-contract/fans-inputs";
import { serveSetting, type SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import { DUCT_PARAMETER_KEYS, ductParameterNameSchema, DUCT_UNIT_KINDS, DUCTS_CRITERIA_CELLS, criteriaLayer, criteriaMeta } from "@pe/ducts-contract/duct-inputs";

import { draftCellSchema, type Author } from "@pe/agent-contracts/draft";
import type { FansDocument } from "@pe/fans-contract/fans";
import { type RouteStateSpec } from "@pe/agent-contracts/route-state";

export const ductAssumptionSchema = z.discriminatedUnion("kind", [
  /**
   * capped: the open end carries no flow; connect: it must be connected in the model; ignore: leave
   * it out. On a proximity finding id: ignore breaks the inference; connect confirms it (and joins a
   * near miss across classifications anyway). Only a staged verdict rules.
   */
  z.strictObject({ kind: z.literal("verdict"), verdict: z.enum(["capped", "connect", "ignore"]) }),
  z.strictObject({ kind: z.literal("flex-roughness"), ft: z.number().positive() }),
  z.strictObject({ kind: z.literal("fan-static"), inWg: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal("component-drop"), inWg: z.number().nonnegative() }),
]);
export type DuctAssumption = z.infer<typeof ductAssumptionSchema>;

/** A deadhead has no encounter closer, so neither button nor staging can accept it. */
export function encounterPatches(issue: FanIssue, choice: "connect" | "ignore", doc: DuctsRouteDocument | null) {
  if (issue.closer.kind !== "encounter") throw Error("This encounter cannot be ruled");
  const e = issue.closer.encounter, key = `encounter:${e.elementId}:${e.connector}`;
  return cellPatches(["assumptions"], key, doc?.assumptions[key] ?? {},
    { kind: "set", rung: { value: { kind: "verdict", verdict: choice } } });
}

const OVERRIDES = ["flex-roughness", "fan-static", "component-drop"] as const;
export type DuctOverrideKind = (typeof OVERRIDES)[number];

const kindOfKey = (key: string): DuctAssumption["kind"] => {
  const head = key.slice(0, key.indexOf(":"));
  return (OVERRIDES as readonly string[]).includes(head) ? (head as DuctOverrideKind) : "verdict";
};

export { DUCT_PARAMETER_KEYS } from "@pe/ducts-contract/duct-inputs";

export const DUCT_AIR_TYPES = ["supply", "return", "exhaust", "fresh", "unknown"] as const;
export type DuctAirType = (typeof DUCT_AIR_TYPES)[number];
const ductInk = z.string().regex(/^#[\da-f]{6}$/i, "Use a six-digit hex colour, such as #0569a5");
export const ductSystemColoursSchema = z.strictObject({
  supply: ductInk,
  return: ductInk,
  exhaust: ductInk,
  fresh: ductInk,
  unknown: ductInk,
});
export type DuctSystemColours = z.infer<typeof ductSystemColoursSchema>;

/** One group's subject: element ids in walking order. The web cuts legs from it (`ducts/legs.ts`). */
const subjectSchema = z.array(z.number().int()).min(1).readonly();


export const ductsDocumentSchema = z
  .strictObject({
    /** The project's design criteria over the firm file (ducts LEDGER 2026-10-29): one cell per criterion and side, pending until apply. */
    criteria: z
      .strictObject({
        velocitySupplyFpm: draftCellSchema(DUCTS_CRITERIA_CELLS.velocitySupplyFpm.value).optional(),
        velocityReturnFpm: draftCellSchema(DUCTS_CRITERIA_CELLS.velocityReturnFpm.value).optional(),
        terminalDropInWg: draftCellSchema(DUCTS_CRITERIA_CELLS.terminalDropInWg.value).optional(),
        autoJoinGapIn: draftCellSchema(DUCTS_CRITERIA_CELLS.autoJoinGapIn.value).optional(),
        healBoxIn: draftCellSchema(DUCTS_CRITERIA_CELLS.healBoxIn.value).optional(),
        splitPolicy: draftCellSchema(DUCTS_CRITERIA_CELLS.splitPolicy.value).optional(),
        allowanceSupplyInWg: draftCellSchema(DUCTS_CRITERIA_CELLS.allowanceSupplyInWg.value).optional(),
        allowanceReturnInWg: draftCellSchema(DUCTS_CRITERIA_CELLS.allowanceReturnInWg.value).optional(),
      })
      .default({}),
    /** A unit kind ruled per family type, keyed JSON.stringify([family, type]); suggested from ports otherwise. */
    kinds: z
      .record(z.string().min(1), draftCellSchema(z.strictObject({ kind: z.enum(DUCT_UNIT_KINDS) })))
      .default({}),
    /** Authored scope for host-derived repair and fan commands; never a native request. */
    writeIntent: draftCellSchema(
      z.strictObject({
        /** Network groups as SubjectRef `group:<id>` codes (ADR 0035 rule 2), decoded at this door. */
        groups: z
          .array(
            subjectRefCodeSchema.refine((code) => decode(code).ok && subjectOf(code).keyKind === "group", {
              message: "a write-scope group is a group:<id> SubjectRef",
            }),
          )
          .readonly()
          .optional(),
        cells: z
          .array(z.tuple([z.literal("rules"), z.string().min(1)]).readonly())
          .min(1)
          .readonly()
          .optional()
          .describe(
            'The rule cells whose fitting coefficients a /fans sheet.apply writes to elements, for example [["rules","elbow-round"]]; omitted, no fitting is written. The rule itself stays staged. Preview and apply use the same scope.',
          ),
        fan: z.strictObject({ unitId: z.number().int(), systemId: z.number().int() }).optional(),
      }),
    ).default({}),
    /** Deletable: a delete edit takes back the verdict the model's store holds at that key. */
    assumptions: z
      .record(z.string(), draftCellSchema(ductAssumptionSchema, { deletable: true }))
      .default({}),
    rules: z
      .record(z.string(), draftCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    /** Key = JSON.stringify([family, type]), type "" for the whole family; edited link beats the Pe_Catalog TYPE fact. */
    catalogs: z
      .record(z.string(), draftCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    /** Key = a fitting family name no rule matches; the cell holds the rule key it is priced as. Read before any rule's own `when`; stays in Pe like `catalogs`. */
    ruleAssignments: z
      .record(z.string().min(1), draftCellSchema(z.strictObject({ rule: z.string().min(1) })))
      .default({}),
    /** Keyed by group id (`g<min element id>`): the ordered element ids of that group's system as intended. */
    subject: z.record(z.string().min(1), draftCellSchema(subjectSchema)).default({}),
    /** The instance parameter whose value names equipment for people; absent reads the firm tag PE_G___TagInstance. */
    labelParameter: draftCellSchema(z.string().min(1).nullable()).default({}),
    /** The phase the network is read in; null (or no cell) reads every element. */
    workingPhase: draftCellSchema(z.string().min(1).nullable()).default({}),
    /** Shared picture palette. Persisted with ducts Work; never included in Revit apply. */
    systemColours: draftCellSchema(ductSystemColoursSchema).default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.assumptions)) {
      const value = cell.edit?.value;
      if (value && value.kind !== kindOfKey(key))
        ctx.addIssue({
          code: "custom",
          path: ["assumptions", key, "edit", "value"],
          message: `the key ${key} holds a ${kindOfKey(key)}, not a ${value.kind}`,
        });
    }
  });
export type DuctsRouteDocument = z.infer<typeof ductsDocumentSchema>;

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
const stagedOf = <V>(work: "fans" | "duct-systems", segment: string, cells: Record<string, { invalid?: string; edit?: { value?: V; by?: Author; ref?: string } | null } | undefined>) =>
  Object.fromEntries<StagedCell<V>>(
    Object.entries(cells).flatMap(([key, cell]): [string, StagedCell<V>][] => {
      if (cell?.invalid) return [[key, { invalid: cell.invalid, ref: `work:${work}/${segment}/${key}` }]];
      const edit = cell?.edit;
      return edit?.value === undefined || (edit.by !== "human" && edit.by !== "pea") ? []
        : [[key, { value: edit.value, by: edit.by, ref: edit.ref?.trim() ? edit.ref : `work:${work}/${segment}/${key}` }]];
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
    Object.fromEntries(Object.entries(cells).flatMap(([key, cell]) => (cell?.edit?.value === undefined ? [] : [[key, cell.edit.value]]))) as Record<string, V>;
  return { ...stagedDucts(doc, fans), rules: bare(doc?.rules ?? {}), kinds: bare(doc?.kinds ?? {}),
    assumptions: bare(doc?.assumptions ?? {}), catalogs: bare(doc?.catalogs ?? {}), ruleAssignments: bare(doc?.ruleAssignments ?? {}),
    terminalDrops: bare(fans.terminalDrops), componentDrops: bare(fans.componentDrops), ratedEsp: bare(fans.ratedEsp),
    equipmentFlows: bare(fans.equipmentFlows), roles: bare(fans.roles), flows: bare(fans.flows), subject: bare(doc?.subject ?? {}) };
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
const flowReceipts = z.record(z.string(), z.strictObject({
  cfm: z.number().nonnegative(),
  source: optionalText,
  appliedAt: z.string(),
  parameter: optionalText,
})).optional();
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
const slotsSchema = z.strictObject({
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
}).refine(s => !s.requiredEsp || s.requiredEsp.toLowerCase() !== s.ratedEsp?.toLowerCase(), "requiredEsp and ratedEsp name the same parameter");
/** Pe server consumes host-priced leg results; Specific Coefficient freezes one export coefficient. */
export const DUCT_FITTING_METHODS = ["pe-server", "specific-coefficient"] as const;
export type DuctFittingMethod = (typeof DUCT_FITTING_METHODS)[number];
export const ductsApplyInputSchema = z.strictObject({
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
   * This apply's store entries (`DuctLossStore` v2). The native op overlays them per key on the
   * model's store (K3): a key omitted here keeps its stored entry; provenance records only writes
   * that land. `workRevision` is the model store's revision as read; an older one refuses as stale.
   */
  store: z.looseObject({
    /** 2; the native op reads v1 and v2 and writes v2. */
    version: z.number().int().optional(),
    rules: z.record(z.string(), z.strictObject({ table: optionalText })).optional(),
    instances: z
      .record(
        z.string(),
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
        z.string(),
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
    /** Unit roles (`fan` or `passive`) a person ruled, by element id. */
    roles: z
      .record(z.string(), z.strictObject({ role: z.string().min(1), ruledAt: z.string() }))
      .optional(),
    slots: slotsSchema.nullable().optional(),
    workRevision: z.number().int().nonnegative().optional(),
    appliedAt: optionalText,
  }),
  /** Stored keys this apply removes; omission never deletes (native `DuctStoreDeletes`). */
  storeDeletes: z
    .strictObject({
      rules: z.array(z.string()).optional(),
      instances: z.array(z.number().int()).optional(),
      terminals: z.array(z.number().int()).optional(),
      terminalFlows: z.array(z.number().int()).optional(),
      equipmentFlows: z.array(z.number().int()).optional(),
      verdicts: z.array(z.string()).optional(),
      roles: z.array(z.number().int()).optional(),
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
  route: "duct-systems",
  retired: ["ducts"],
  settingsOwners: ["ducts"],
  title: "Ducts",
  description:
    "Human and Pea edit shared Work at an expected revision. Duct pressure-drop Work, one shared cell per key; the fan-side cells (drops, flows, equipmentFlows, roles) are /fans Work. criteria: one cell per criterion and side (velocitySupplyFpm, velocityReturnFpm, terminalDropInWg, autoJoinGapIn, healBoxIn, splitPolicy even | proportional, allowanceSupplyInWg, allowanceReturnInWg), each served from staged Work first, then the project or firm setting, then the engine default. Design friction is a project and firm setting in Settings/ducts.json, never Work or written to Revit. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore), and a proximity:<...> finding id holds ignore (break that inferred join) or connect (confirm it, or join a near miss across air classifications anyway); a near-miss or stretched join is bridged by the route and final (a diagnostic, no verdict owed); only an anomalous join (reversed connector, part through its host, cross-class) leaves a result provisional until an author edits a verdict, and a suggested verdict never makes it final, so include the evidence for a suggested ruling in the note; flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. An ignore verdict (an open end left out, an inferred join objected to) is a ruling the model keeps in its _PE_DuctLosses store: ducts.snapshot store.verdicts are the standing rulings, Work holds only pending changes over them (a staged verdict prices while staged; a /duct-systems sheet.apply stores it), and either author removes a stored verdict with a delete edit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. ruleAssignments: a fitting family name no rule matches holds { rule }, the loss-rule key every fitting of that family is priced as (read before any rule's own match; stays in Pe, never written to Revit). catalogs: JSON.stringify([family, type]) (type \"\" = every type of the family) holds { table }, the manufacturer catalog table id; edited links beat the family TYPE Pe_Catalog parameter and stay in Work. The scene: subject is keyed by group id (the id from ducts.snapshot groups, g<lowest element id>), each cell holding the ordered element ids of that group's whole system as intended, end to end (outdoor intake or terminal through every element to the last equipment), including elements past a break; list every element in order, short stubs and transitions too, and never stop at the last connected element: the route draws breaks and omissions, so leave nothing out to avoid a gap. labelParameter is one cell naming the instance parameter whose value names equipment for people; absent it reads PE_G___TagInstance, the firm equipment tag (type counterpart PE_G___TagType), not the built-in Mark. workingPhase is one cell naming the phase the network is read in: suggest or edit the phase (a name in ducts.snapshot phases.order) that the snapshot's phases.views census shows in most views; the route leaves out every element that does not exist in it and warns out-of-phase where one touches the network. Fan inputs (flows, terminalDrops, componentDrops, equipmentFlows, roles) belong to /fans; edit them only there. /duct-systems owns rules, kinds, criteria, design friction and network rulings. A claim on an element, with its verdict, is a finding (findings.say), not ducts Work. Either author may edit rules, catalogs, the subject, the label parameter and the working phase; a /fans sheet.plan previews fitting coefficients for rules named in writeIntent.cells. The whole plan refuses unless the table for each named rule used by those fitting writes is saved in the model. Save the tables on /duct-systems first. A /fans sheet.apply writes the planned coefficients to elements and unit roles to the store. Rule tables and verdicts stay staged through it. A /duct-systems sheet.plan and sheet.apply (pass this route's Work handle) store every staged rule table and ignore verdict, remove a stored verdict staged for delete, and write no element. A capped or connect verdict over a stored ignore removes the stored one, and its cell stays staged.",
  schema: ductsDocumentSchema,
  finds: DUCTS_FINDS,
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;

/** Host requests project only served names; native fallbacks belong to the default tier. */
export const ductParameterSlots = (settings?: readonly SettingTierRead[]) =>
  Object.fromEntries(DUCT_PARAMETER_KEYS.map(key => {
    const served = serveSetting(settings, ["project", "firm"], ["parameters", key], ductParameterNameSchema(key));
    return [key, { name: served.value, source: ductSlotSourcesSchema.valueType.shape.source.parse(served.tier), ref: served.ref, note: served.note }];
  }));
export const ductSlotSourcesSchema = z.record(z.string(), z.object({ name: z.string().nullable(), source: z.enum(["project", "firm", "default"]), ref: z.string().optional(), note: z.string().optional() }));
export const ductSlotRequest = (settings?: readonly SettingTierRead[]) => Object.fromEntries(Object.entries(ductParameterSlots(settings)).flatMap(([key, slot]) => slot.name == null ? [] : [[key, slot.name]]));
export const slotLayer = (snapshot: { readonly slots: Readonly<Record<string, string | null>>; readonly slotSources?: Readonly<z.output<typeof ductSlotSourcesSchema>> } | null | undefined, key: string) => ({ source: "default" as const, ...snapshot?.slotSources?.[key], value: snapshot?.slots[key] ?? null });
