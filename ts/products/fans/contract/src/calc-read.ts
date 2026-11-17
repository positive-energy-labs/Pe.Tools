import { z } from "zod";
import { uniqueIdSchema } from "@pe/agent-contracts/subject-ref";
import { documentRefSchema } from "@pe/agent-contracts/target";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import { fanClaimSchema, fanCloserSchema, legEvidenceSchema, fanParameterCohortSchema, fanEspValuesSchema } from "./fans-inputs.ts";
export * from "@pe/ducts-contract/duct-inputs";
import { elementSubjectSchema, ductsInputsSchema, ductFirmLineSchema, calcNoteSchema } from "@pe/ducts-contract/duct-inputs";

const elementId = z.number().int().positive();
const portIndex = z.number().int().nonnegative();
const detail = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("legs"), pathId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("elements") }),
  z.strictObject({ kind: z.literal("inputs") }),
  /** Every run and section of a fan sheet (ducts LEDGER 2026-10-29): the page's worksheet and the picture's strands. */
  z.strictObject({ kind: z.literal("worksheet") }),
]);
const common = {
  target: documentRefSchema,
  basis: z.string().min(1).optional(),
  detail: detail.optional(),
};
export const ductsCalcRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...common, mode: z.literal("fan"), unitId: elementId, portIndex }),
  z.strictObject({
    ...common,
    mode: z.literal("chain"),
    start: z.strictObject({ elementId, connector: portIndex.optional() }),
    end: z.strictObject({ elementId }),
    direction: z.enum(["supply", "return"]),
  }),
]);
export type DuctsCalcRequest = z.infer<typeof ductsCalcRequestSchema>;
export const ductsRosterRequestSchema = z.strictObject({
  target: documentRefSchema,
  mark: z
    .string()
    .min(1)
    .optional()
    .describe("Equipment mark, e.g. MA-1. Returns only the ports whose mark matches (case-insensitive). Omit for the whole roster."),
});

/** Pea's product instructions for the pressure-drop sheet. */
// ponytail: Switch these guide read ids to P4-wire's constants after it merges.
export const GUIDE_CALC_READS = { calc: "fans.calc", detail: "fans.calc-detail", breakdown: "fans.calc-breakdown" } as const;

export const FAN_CALC_GUIDE = {
  summary:
    "Read one fan's pressure-drop calc. Each number is a sum along a path; an incomplete known subtotal is never required ESP.",
  walk: [
    "Read route:reads.value (read fans.roster) with {target: {session, openId}, mark}: it returns only the ports whose mark matches, case-insensitive. Use the row's unitId and portIndex; marks are not unique, so several rows can return, and no row means no fan port carries that mark. Omit mark only when the whole roster is wanted. A family or type name (Fantech MUAS 10, Greenheck ESD-403) identifies a product, not the unit the person named; match the mark. Suggestions remain unconfirmed until the engineer rules.",
    `Read route:reads.value (read ${GUIDE_CALC_READS.detail}) with {target, mode: 'fan', unitId, portIndex}. For a named start and end, use mode 'chain', start {elementId, connector?}, end {elementId}, and asserted direction 'supply' or 'return'. A chain makes no fan ESP claim.`,
    "Read the sheet's blockers back to the person with their element and connector, effect on the total, and closer. Report known subtotal, completeness, and required ESP exactly as returned. Never call an incomplete path critical.",
    "The calc read takes no edits and writes nothing; every ruling and input below is staged in document Work through the route's Work verbs, then the calc is read again. Follow Fix in /duct-systems for a returned heal proposal, accepted or rejected there as a join ruling, edits.joins [{pair, verdict}], never a Revit heal. Assumed ESP uses the continued walk; flow and pricing gaps still withhold it. An open end a person rules capped is written as edits.ends [{end: {elementId, connector}, verdict: 'capped'}]; it is then neither an end nor a blocker. Every other input is an edit on Work's own key: edits.flows (a terminal's cfm), edits.terminalDrops, edits.componentDrops, edits.equipmentFlows (a unit's), edits.roles and edits.kinds (rulings), edits.criteria (the project's design criteria over the firm file). A fitting's pricing is in the inputs detail's fittings census (rule, table, matched or chosen): edits.tables {ruleKey: {table}} swaps the table every fitting of that rule reads; a not-priced fitting is closed with edits.assignments {family: {rule}} (one of its candidates; prices every fitting of the family no rule matches), or, on a path through a proposed tee, tap or transition only (a transition replaces a capped end, one straight path), a typed edits.fittingDrops {key: {inWg}} for that one path. The inputs detail returns every resolved value with its source (run, Work, model, firm, default, none), units, version and missing/invalid status. A 'sibling-fan' end is another fan sharing the trunk, priced to the junction and carrying none of this fan's flow.",
    "Use the returned next handles with the same target, mode, and basis to read a path's legs, walked elements, or inputs and provenance. A stale response means read a new overview; never reuse a handle against a different basis.",
    `Read ${GUIDE_CALC_READS.calc} for the fan editor projection and ${GUIDE_CALC_READS.breakdown} for runs and sections. Required ESP is a result, never staged. Firm requiredEsp configuration may select writes nowhere explicitly; absent or null inherits the default.`,
    "Read inputs detail for the full closer notes and candidates. Propose a sourced default or a basis-bound previewed heal for a blocker, with its effect on the total. Use only an available typed preview/write contract and the returned candidate. If that door is unavailable, report it as owed; do not substitute old group heals. After an authorized change, read a new sheet and report its measured effect. Unknown effects stay unknown until recomputed.",
  ],
  never: [
    "Never grep raw snapshots or analysis artifacts for pressure drop.",
    "Never elect groups, assign a system fan, or use circuit calculations, or network totals as the pressure-drop path.",
    "Never compute pressure drop by hand or rebuild the engine in scripts.",
    "Never write required ESP from an incomplete calc or confuse a fan's rated ESP with its required ESP.",
  ],
} as const;
const fanRef = z.object({ unitId: elementId, portIndex });
const fan = fanRef.extend({
  mark: z.string(),
  ratedEspInWg: z.number().nullable(),
  inletPortIndex: portIndex.nullable(),
  dischargePortIndex: portIndex,
  /** Q4: the family's connector direction set the roles and the network's ends read the other way; null when they agree. */
  directionMismatch: z.object({ discharge: portIndex, networkDischarge: portIndex, evidence: z.string() }).nullable(),
  flowCfm: z.number().nullable(),
});
const pathEnd = z.object({
  /** `sibling-fan` (R-SIB): a named fan sharing the trunk; priced to the junction, 0 cfm, no blocker. */
  kind: z.enum(["terminal", "open-end", "roster-fan-port", "joins-other-fan", "sibling-fan"]),
  elementId,
  connector: portIndex.optional(),
  fan: fanRef.nullable().optional(),
});
const sideTotals = z.object({
  worstPath: z.number().nullable(),
  knownInWg: z.number(),
  assumedInWg: z.number().nullable(),
  allowanceInWg: z.number(),
  telFt: z.number(),
  frictionRatePer100: z.number().nullable(),
});
const totals = z.object({
  supply: sideTotals,
  return: sideTotals,
  requiredEspInWg: z.number().nullable(),
  requiredEspAssumedInWg: z.number().nullable(),
});
const leg = z.object({
  /** How the leg was priced, as data: the engine states it on every leg. */
  evidence: legEvidenceSchema,
  id: z.string(),
  elementId,
  kind: z.enum(["duct", "fitting", "accessory", "equipment", "terminal"]),
  inConnector: portIndex.optional(),
  outConnector: portIndex.optional(),
  flowCfm: z.number().nullable(),
  flowSource: z.string().nullable(),
  velocityFpm: z.number().nullable(),
  lossInWg: z.number().nullable(),
  lossSource: z.object({ kind: z.enum(["friction", "rule", "drop", "default"]), ref: z.string() }),
  equivalentFt: z.number().nullable(),
});
const healProposal = z.object({
  kind: z.enum(["join", "tap", "tee", "transition"]),
  from: z.object({ elementId, connector: portIndex, point: z.array(z.number()).length(3) }),
  to: z.object({
    elementId,
    connector: portIndex.nullable(),
    point: z.array(z.number()).length(3),
  }),
  pair: z.tuple([z.string(), z.string()]),
  gapIn: z.number().nonnegative(),
  fittingChange: z.boolean(),
  /** The end cap a `transition` removes from the occupied target connector. */
  replaces: z.object({ elementId }).optional(),
  risk: z.string(),
  assumedLegs: z.array(leg),
});
const blocker = z.object({
  id: z.string(),
  kind: z.enum(FAN_BLOCKER_KINDS),
  typedCloser: fanCloserSchema.optional(),
  elementId,
  /** The element's `UniqueId:` SubjectRef code; absent only for a stand-in with no element. */
  subject: elementSubjectSchema.optional(),
  connector: portIndex.optional(),
  effectInWg: z.number().nullable(),
  closer: z.enum(["default", "heal", "ruling"]),
  proposal: healProposal.optional(),
  owner: fanRef.optional(),
  /** R-B: the open-end blocker whose assumed heal exposed this one; a consequence, not a gap of its own. */
  causedBy: z.string().optional(),
  /** A not-priced fitting's row in the inputs detail's `fittings` census, by key. */
  fitting: z.string().optional(),
});
/**
 * How one fitting (or one path through a proposed fitting) is priced: the rule and table, and
 * whether each was matched by the rule's own condition or chosen by a person (ducts LEDGER
 * 2026-10-29: `ruleAssignments` by family, then the rule's own match; `rules[key].table` swaps the
 * table). `candidates` are the rules a person may price it with; `options` the tables its rule may swap to.
 */
const fittingPricingFields = {
  /** Controlling priced leg, including its table inputs and interpolation boundary. */
  derivation: z.string().optional(),
  family: z.string().nullable(),
  rule: z.string().nullable(),
  table: z.string().nullable(),
  ruleSource: z.enum(["matched", "assigned", "none"]),
  tableSource: z.enum(["default", "fallback", "typed", "stored"]).nullable(),
  options: z.array(z.string()),
  candidates: z.array(
    z.object({ rule: z.string(), words: z.string(), tables: z.array(z.string()) }),
  ),
  lossInWg: z.number().nullable(),
  /** Why it is not priced; null when priced. */
  unpriced: z.string().nullable(),
  /** The typed per-path drop standing in for the table (proposed paths only). */
  typed: z.number().nullable(),
};
/** One path through a proposed fitting (a heal's tee, tap or transition): no element exists yet. */
export const proposedPathSchema = z.object({
  /** The two connectors it joins, `<elementId>:<connector>`: the proposal's identity in the model. */
  pair: z.tuple([z.string(), z.string()]),
  kind: z.enum(["join", "tee", "tap", "transition"]),
  /** A transition has one path, `straight` (keyed `proposed:<pair>>straight`). */
  path: z.enum(["branch", "straight"]),
  /** The main element the path continues into; null on the straight path. */
  toward: elementId.nullable(),
});
export const fittingPricingSchema = z.union([
  z.object({
    /** The fitting's element id, as a string. */
    key: z.string(),
    elementId,
    proposed: z.undefined().optional(),
    ...fittingPricingFields,
  }),
  z.object({
    /**
     * `proposed:<pair>><toward>`: the path's identity. A proposed fitting is no element, so it has
     * no element id; `proposed.pair` names the connectors it would join.
     */
    key: z.string().regex(/^proposed:/),
    elementId: z.null(),
    proposed: proposedPathSchema,
    ...fittingPricingFields,
  }),
]);
export type FittingPricing = z.infer<typeof fittingPricingSchema>;
const pathSummary = z.object({
  pathId: z.string(),
  end: pathEnd,
  knownInWg: z.number(),
  legCount: z.number().int(),
  blockerIds: z.array(z.string()),
});
const rankedSide = z.object({
  paths: z.array(pathSummary).max(5),
  rest: z.number().int().nonnegative(),
});
const responseBase = { target: documentRefSchema, basis: z.string() };
const side = z.enum(["supply", "return"]);
const calcBreakdownSection = z.object({
  id: z.string(),
  side,
  legIds: z.array(z.string()),
  runIds: z.array(z.string()),
  cfm: z.number().nullable(),
  knownInWg: z.number(),
  unpricedLegs: z.number().int().nonnegative(),
  telFt: z.number(),
  maxFpm: z.number().nullable(),
  overLegIds: z.array(z.string()),
});
const calcBreakdownRun = z.object({
  id: z.string(),
  side,
  end: pathEnd,
  legIds: z.array(z.string()),
  sectionIds: z.array(z.string()),
  cfm: z.number().nullable(),
  telFt: z.number(),
  knownInWg: z.number(),
  complete: z.boolean(),
  residualInWg: z.number().nullable(),
  critical: z.boolean(),
  maxFpm: z.number().nullable(),
  overLegIds: z.array(z.string()),
});
const calcBreakdownSide = z.object({
  runs: z.array(calcBreakdownRun),
  sections: z.array(calcBreakdownSection),
  worstKnownInWg: z.number().nullable(),
  elementSections: z.record(z.string(), z.array(z.string())),
});
export const ductsCalcOverviewSchema = z.object({
  claim: fanClaimSchema.optional(),
  espValues: fanEspValuesSchema.optional(),
  cohorts: z.array(fanParameterCohortSchema).optional(),
  ...responseBase,
  kind: z.literal("overview"),
  mode: z.enum(["fan", "chain"]),
  fan: fan.nullable(),
  totals: totals.nullable(),
  paths: z.object({ supply: rankedSide, return: rankedSide }),
  blockers: z.array(blocker),
  assumedBlockers: z.array(blocker),
  next: z.object({
    hint: z.string(),
    legs: z.array(detail.options[0]),
    elements: detail.options[1],
    inputs: detail.options[2],
    calcBreakdown: detail.options[3],
  }),
});
export const ductsCalcResponseSchema = z.discriminatedUnion("kind", [
  ductsCalcOverviewSchema,
  z.object({ ...responseBase, kind: z.literal("legs"), pathId: z.string(), legs: z.array(leg) }),
  z.object({
    ...responseBase,
    kind: z.literal("elements"),
    walkedElementIds: z.array(elementId),
    /** Context only, never priced: each unit this fan stops at, and a short stub from each of its ports. */
    beyond: z.array(
      z.object({
        unitId: elementId,
        mark: z.string(),
        elementIds: z.array(elementId),
        /** The duct a stub ends in, cut at the reach; keep the side toward `from`. */
        cuts: z.array(
          z.object({ id: elementId, from: z.array(z.number()), at: z.array(z.number()) }),
        ),
      }),
    ),
  }),
  z.object({
    ...responseBase,
    kind: z.literal("worksheet"),
    limits: z.object({ supplyFpm: z.number(), returnFpm: z.number(), supplySource: z.string(), returnSource: z.string() }),
    supply: calcBreakdownSide,
    return: calcBreakdownSide,
    /** Every leg a run names, by leg id. */
    legs: z.record(z.string(), leg),
  }),
  z.object({
    ...responseBase,
    kind: z.literal("inputs"),
    inputs: ductsInputsSchema,
    /**
     * The firm layer: the file's version, or "seed" with present false when the file is absent;
     * refused without a shared root, where the sheet runs on the seed and its firm fields are disabled.
     */
    firm: ductFirmLineSchema,
    ends: z.array(pathEnd),
    /** Every fitting the sheet priced, or failed to, with its rule, table and their sources. */
    fittings: z.array(fittingPricingSchema),
    /** The ASHRAE title of every table the sheet was served (`CD3-1  Elbow, Die Stamped, 90 Degree, r/D = 1.5 (…)`), by id. */
    tableTitles: z.record(z.string(), z.string()),
    notes: z.array(calcNoteSchema),
    blockers: z.array(
      blocker.omit({ closer: true }).extend({
        detail: z.string(),
        closer: z.object({
          kind: z.enum(["default", "heal", "ruling"]),
          note: z.string(),
          candidate: z
            .object({
              toElementId: elementId,
              toConnector: portIndex.nullable(),
              gapIn: z.number(),
              pair: z.tuple([z.string(), z.string()]),
            })
            .optional(),
          crossing: z
            .object({
              toElementId: elementId,
              toConnector: portIndex,
              distanceIn: z.number(),
              classes: z.tuple([z.string(), z.string()]),
              pair: z.tuple([z.string(), z.string()]),
            })
            .optional(),
        }),
      }),
    ),
  }),
]);
export type DuctsCalcResponse = z.infer<typeof ductsCalcResponseSchema>;
export type DuctsCalcOverview = z.infer<typeof ductsCalcOverviewSchema>;
export const ductsRosterResponseSchema = z.object({
  target: documentRefSchema,
  slots: z.array(
    z.object({
      slot: z.string(),
      covered: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  activeSlot: z.string(),
  rows: z.array(
    z.object({
      unitId: elementId,
      uniqueId: uniqueIdSchema,
      portIndex,
      mark: z.string(),
      /** Display disambiguators for a duplicate mark; the UniqueId is identity, never text. */
      level: z.string().nullable().optional(),
      system: z.string().nullable().optional(),
      kind: z.enum(DUCT_UNIT_KINDS),
      side: z.enum(["supply", "return", "exhaust", "outdoor"]),
      ratedEspInWg: z.number().nullable(),
      confirmed: z.boolean().optional(),
      blockerCount: z.number().int().optional(),
      requiredEspInWg: z.number().nullable().optional(),
      requiredEspAssumedInWg: z.number().nullable().optional(),
      complete: z.boolean().optional(),
    }),
  ),
});
export type DuctsRosterResponse = z.infer<typeof ductsRosterResponseSchema>;
