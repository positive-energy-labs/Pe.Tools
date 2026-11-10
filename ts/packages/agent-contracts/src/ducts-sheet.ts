import { z } from "zod";
import { documentRefSchema } from "./target.ts";
import { VALUE_SOURCES } from "./work-value.ts";

const elementId = z.number().int().positive();
const portIndex = z.number().int().nonnegative();
const detail = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("legs"), pathId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("elements") }),
  z.strictObject({ kind: z.literal("inputs") }),
  /** Every run and section of a fan sheet (ducts LEDGER 2026-10-29): the page's worksheet and the picture's strands. */
  z.strictObject({ kind: z.literal("worksheet") }),
]);
/** Resolved engine inputs expose the winning Work layer and its revision (ADR 0028). */
export const DUCT_INPUT_SOURCES = [...VALUE_SOURCES, "none"] as const;
export type DuctInputSource = (typeof DUCT_INPUT_SOURCES)[number];
const resolved = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value,
    source: z.enum(DUCT_INPUT_SOURCES),
    ref: z.string().optional(),
    units: z.string().nullable(),
    version: z.union([z.string(), z.number()]).nullable(),
    status: z.enum(["valid", "missing", "invalid"]),
  });
// TODO: docs/features/routes/LEDGER.md#s7-2f8fa50d55 G1 render authored Work values separately; badge source from this reading (Work/model/firm/default).
export type Resolved<T> = Omit<import("./work-value.ts").ValueResolution<T>, "value"> & {
  value: T;
};
const num = z.number().finite();
const nonneg = num.nonnegative();
const elementKey = z.string().regex(/^[1-9]\d*$/);
const sided = <T extends z.ZodType>(value: T) => z.strictObject({ supply: value, return: value });
const splitPolicy = z.enum(["even", "proportional"]);
/** The design criteria a person edits (Work `criteria`) and the firm file carries; the resolver stamps sources. */
export const ductsCriteriaValuesSchema = z.strictObject({
  /** A leg above this is "over", the one alarm the sheet paints; Manual D rules of thumb by default. */
  velocityLimitFpm: sided(num.positive()),
  /** A terminal with no typed, catalog or Revit drop takes this. */
  terminalDropInWg: nonneg,
  /** Facing vacant ports within this gap join without a click (Q5). The C# read measures under it. */
  autoJoinGapIn: nonneg,
  /** The widest gap a heal proposal reaches (Q6). The C# read measures under it. */
  healBoxIn: nonneg,
  splitPolicy,
  allowanceInWg: sided(nonneg),
});
export type DuctsCriteriaValues = z.infer<typeof ductsCriteriaValuesSchema>;
/**
 * The project layer over the firm file (Work `criteria`, the model's store): every criterion, and
 * each side of a sided one, optional on its own, so typing return never restates supply. The firm
 * file stays `ductsCriteriaValuesSchema`: it states both sides.
 */
export const ductsCriteriaLayerSchema = z.strictObject({
  velocityLimitFpm: sided(num.positive().optional()).optional(),
  terminalDropInWg: nonneg.optional(),
  autoJoinGapIn: nonneg.optional(),
  healBoxIn: nonneg.optional(),
  splitPolicy: splitPolicy.optional(),
  allowanceInWg: sided(nonneg.optional()).optional(),
});
export type DuctsCriteriaLayer = z.infer<typeof ductsCriteriaLayerSchema>;
/** A criteria edit: a value writes that criterion or side, null removes it from the project layer. */
export const ductsCriteriaEditsSchema = z.strictObject({
  velocityLimitFpm: sided(num.positive().nullable().optional()).optional(),
  terminalDropInWg: nonneg.nullable().optional(),
  autoJoinGapIn: nonneg.nullable().optional(),
  healBoxIn: nonneg.nullable().optional(),
  splitPolicy: splitPolicy.nullable().optional(),
  allowanceInWg: sided(nonneg.nullable().optional()).optional(),
});
export type DuctsCriteriaEdits = z.infer<typeof ductsCriteriaEditsSchema>;
export const DUCT_UNIT_KINDS = [
  "fan-coil",
  "air-handler",
  "erv",
  "muas",
  "dehumidifier",
  "other",
] as const;
export type DuctUnitKind = (typeof DUCT_UNIT_KINDS)[number];
const unitRole = z.enum(["fan", "passive"]);
export const joinRulingSchema = z.strictObject({
  pair: z.tuple([z.string().min(1), z.string().min(1)]),
  verdict: z.enum(["accept", "reject"]),
});
export const endRulingSchema = z.strictObject({
  end: z.strictObject({ elementId, connector: portIndex }),
  verdict: z.literal("capped"),
});
export const ductsInputsSchema = z.strictObject({
  terminals: z.record(
    elementKey,
    z.strictObject({ cfm: resolved(nonneg.nullable()), drop: resolved(nonneg.nullable()) }),
  ),
  units: z.record(
    elementKey,
    z.strictObject({
      kind: resolved(z.enum(DUCT_UNIT_KINDS)),
      role: resolved(unitRole),
      /** The unit's own design flow; null reads as the sum of the terminals it serves (never an input). */
      cfm: resolved(nonneg.nullable()),
      esp: resolved(nonneg.nullable()),
    }),
  ),
  /** An accessory, inline equipment, or a fitting a person priced by hand; null when nothing states a drop. */
  components: z.record(elementKey, z.strictObject({ drop: resolved(nonneg.nullable()) })),
  rulings: z.strictObject({ joins: z.array(joinRulingSchema), ends: z.array(endRulingSchema) }),
  criteria: z.strictObject({
    velocityLimitFpm: sided(resolved(num.positive())),
    terminalDropInWg: resolved(nonneg),
    autoJoinGapIn: resolved(nonneg),
    healBoxIn: resolved(nonneg),
    splitPolicy: resolved(splitPolicy),
    allowanceInWg: sided(resolved(nonneg)),
  }),
  /** A loss-rule key's ASHRAE table where a person swapped it (Work `rules`). */
  tables: z.record(z.string(), resolved(z.string().min(1))),
  /**
   * A fitting family no rule matches, priced as the rule a person assigned (Work `ruleAssignments`).
   * Read only where no rule's own match prices the fitting; a matched fitting keeps its rule.
   */
  assignments: z.record(z.string(), resolved(z.string().min(1))),
  /**
   * A typed drop on one path through a proposed fitting (a heal's tee, tap or transition), keyed
   * `proposed:<pair>><toward>` (toward: the main element the branch path continues into, or
   * `straight`). A fallback where no table prices that path; never one number for both paths.
   */
  fittingDrops: z.record(z.string(), resolved(nonneg)),
});
export type DuctsInputs = z.infer<typeof ductsInputsSchema>;
/** The versioned firm file (`<user content>/Firm/ducts.json`): the base layer under every project rule. */
export const ductsFirmSchema = z.strictObject({
  version: z.string().min(1),
  criteria: ductsCriteriaValuesSchema,
});
export type DuctsFirm = z.infer<typeof ductsFirmSchema>;
/**
 * What a cell or Pea writes: Work's own keys, one record per key, `null` deleting the pending edit.
 * The host applies them to document Work and recomputes; nothing here reaches Revit until apply.
 */
const edits = <T extends z.ZodType>(value: T) => z.record(elementKey, value.nullable());
export const ductsSheetEditsSchema = z.strictObject({
  flows: edits(z.strictObject({ cfm: nonneg })).optional(),
  terminalDrops: edits(z.strictObject({ inWg: nonneg })).optional(),
  componentDrops: edits(z.strictObject({ inWg: nonneg })).optional(),
  esp: edits(z.strictObject({ inWg: nonneg })).optional(),
  equipmentFlows: edits(z.strictObject({ cfm: nonneg })).optional(),
  roles: edits(z.strictObject({ role: unitRole })).optional(),
  /** Keyed by JSON.stringify([family, type]); one ruling fixes every instance of the type. */
  kinds: z
    .record(z.string(), z.strictObject({ kind: z.enum(DUCT_UNIT_KINDS) }).nullable())
    .optional(),
  criteria: ductsCriteriaEditsSchema.optional(),
  tables: z.record(z.string(), z.strictObject({ table: z.string().min(1) }).nullable()).optional(),
  /** Keyed by fitting family; one rule prices every fitting of the family no rule matches (Work `ruleAssignments`). */
  assignments: z
    .record(z.string().min(1), z.strictObject({ rule: z.string().min(1) }).nullable())
    .optional(),
  /** Keyed like `inputs.fittingDrops`; written to Work `assumptions` as `component-drop:<key>`. */
  fittingDrops: z
    .record(z.string().regex(/^proposed:/), z.strictObject({ inWg: nonneg }).nullable())
    .optional(),
  joins: z
    .array(
      z.strictObject({
        pair: joinRulingSchema.shape.pair,
        verdict: z.enum(["accept", "reject", "clear"]),
      }),
    )
    .optional(),
  ends: z
    .array(z.strictObject({ end: endRulingSchema.shape.end, verdict: z.enum(["capped", "clear"]) }))
    .optional(),
});
export type DuctsSheetEdits = z.infer<typeof ductsSheetEditsSchema>;
/** A closure or reading the engine took on its own: shown, never parsed. */
export const sheetNoteSchema = z.strictObject({
  kind: z.enum([
    "direction",
    "inflow",
    "sibling",
    "capped",
    "auto-join",
    "heal",
    "assumed-flow",
    "flow-conflict",
    "merge",
    "demoted",
  ]),
  text: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
});
export type SheetNote = z.infer<typeof sheetNoteSchema>;

const common = {
  target: documentRefSchema,
  basis: z.string().min(1).optional(),
  detail: detail.optional(),
  /** Pending edits to apply to document Work before computing. */
  edits: ductsSheetEditsSchema.optional(),
  /** Basis-bound calculation ruling. Does not change the Revit model. */
  proposal: z
    .strictObject({
      pair: z.tuple([z.string().min(1), z.string().min(1)]),
      verdict: z.enum(["accept", "reject"]),
    })
    .optional(),
};
export const ductsSheetRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...common, mode: z.literal("fan"), unitId: elementId, portIndex }),
  z.strictObject({
    ...common,
    mode: z.literal("chain"),
    start: z.strictObject({ elementId, connector: portIndex.optional() }),
    end: z.strictObject({ elementId }),
    direction: z.enum(["supply", "return"]),
  }),
]);
export type DuctsSheetRequest = z.infer<typeof ductsSheetRequestSchema>;
export const ductsRosterRequestSchema = z.strictObject({ target: documentRefSchema });
export type DuctsRosterRequest = z.infer<typeof ductsRosterRequestSchema>;

/** Shared product instructions for Pea and the sheet tutorial. */
export const DUCTS_SHEET_GUIDE = {
  summary:
    "Read one fan's pressure-drop sheet. Each number is a sum along a path; an incomplete known subtotal is never required ESP.",
  walk: [
    "Read route:reads.value (read fans.roster) with the exact target {session, openId}. Match the equipment mark, then use its unitId and portIndex; marks are not unique. A family or type name (Fantech MUAS 10, Greenheck ESD-403) identifies a product, not the unit the person named; match the mark. Suggestions remain unconfirmed until the engineer rules.",
    "Read route:reads.value (read ducts.sheet) with {target, mode: 'fan', unitId, portIndex}. For a named start and end, use mode 'chain', start {elementId, connector?}, end {elementId}, and asserted direction 'supply' or 'return'. A chain makes no fan ESP claim.",
    "Read the sheet's blockers back to the person with their element and connector, effect on the total, and closer. Report known subtotal, completeness, and required ESP exactly as returned. Never call an incomplete path critical.",
    "Accept or reject a returned heal proposal with the same fan request, its basis, and proposal {pair, verdict}. This writes a join ruling to document Work (edits.joins), never a Revit heal. Assumed ESP uses the continued walk; flow and pricing gaps still withhold it. An open end a person rules capped is written as edits.ends [{end: {elementId, connector}, verdict: 'capped'}]; it is then neither an end nor a blocker. Every other input is an edit on Work's own key: edits.flows (a terminal's cfm), edits.terminalDrops, edits.componentDrops, edits.esp and edits.equipmentFlows (a unit's), edits.roles and edits.kinds (rulings), edits.criteria (the project's design criteria over the firm file). A fitting's pricing is in the inputs detail's fittings census (rule, table, matched or chosen): edits.tables {ruleKey: {table}} swaps the table every fitting of that rule reads; a not-priced fitting is closed with edits.assignments {family: {rule}} (one of its candidates; prices every fitting of the family no rule matches), or, on a path through a proposed tee, tap or transition only (a transition replaces a capped end, one straight path), a typed edits.fittingDrops {key: {inWg}} for that one path. The inputs detail returns every resolved value with its source (run, Work, model, firm, default, none), units, version and missing/invalid status. A 'sibling-fan' end is another fan sharing the trunk, priced to the junction and carrying none of this fan's flow.",
    "Use the returned next handles with the same target, mode, and basis to read a path's legs, walked elements, or inputs and provenance. A stale response means read a new overview; never reuse a handle against a different basis.",
    "Read inputs detail for the full closer notes and candidates. Propose a sourced default or a basis-bound previewed heal for a blocker, with its effect on the total. Use only an available typed preview/write contract and the returned candidate. If that door is unavailable, report it as owed; do not substitute old group heals. After an authorized change, read a new sheet and report its measured effect. Unknown effects stay unknown until recomputed.",
  ],
  never: [
    "Never grep raw snapshots or analysis artifacts for pressure drop.",
    "Never elect groups, assign a system fan, or use route:ducts.analysis, circuit calculations, or network totals as the pressure-drop path.",
    "Never compute pressure drop by hand or rebuild the engine in scripts.",
    "Never write required ESP from an incomplete sheet or confuse a fan's rated ESP with its required ESP.",
  ],
} as const;
const fanRef = z.object({ unitId: elementId, portIndex });
const fan = fanRef.extend({
  mark: z.string(),
  ratedEspInWg: z.number().nullable(),
  inletPortIndex: portIndex.nullable(),
  dischargePortIndex: portIndex,
  directionOverride: z.string().nullable().optional(),
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
  complete: z.boolean(),
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
  kind: z.enum([
    "open-end",
    "inferred-join",
    "unknown-drop",
    "no-flow",
    "flow-mismatch",
    "shared-leg",
    "class-change",
    "not-priced",
    "implausible-loss",
    "equipment-pairing",
  ]),
  elementId,
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
  complete: z.boolean(),
  legCount: z.number().int(),
  blockerIds: z.array(z.string()),
});
const rankedSide = z.object({
  paths: z.array(pathSummary).max(5),
  rest: z.number().int().nonnegative(),
});
const responseBase = { target: documentRefSchema, basis: z.string() };
const side = z.enum(["supply", "return"]);
const worksheetSection = z.object({
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
const worksheetRun = z.object({
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
const worksheetSide = z.object({
  runs: z.array(worksheetRun),
  sections: z.array(worksheetSection),
  worstKnownInWg: z.number().nullable(),
  elementSections: z.record(z.string(), z.array(z.string())),
});
export const ductsSheetOverviewSchema = z.object({
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
    worksheet: detail.options[3],
  }),
});
export const ductsSheetResponseSchema = z.discriminatedUnion("kind", [
  ductsSheetOverviewSchema,
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
    limits: z.object({ supplyFpm: z.number(), returnFpm: z.number(), source: z.string() }),
    supply: worksheetSide,
    return: worksheetSide,
    /** Every leg a run names, by leg id. */
    legs: z.record(z.string(), leg),
  }),
  z.object({
    ...responseBase,
    kind: z.literal("inputs"),
    directionOverride: z.string().nullable().optional(),
    inputs: ductsInputsSchema,
    /**
     * The firm layer: the file's version, or "seed" with present false when the file is absent;
     * refused without a shared root, where the sheet runs on the seed and its firm fields are disabled.
     */
    firm: z.union([
      z.strictObject({ version: z.string(), path: z.string(), present: z.boolean() }),
      z.strictObject({ refused: z.literal("no-shared-root") }),
    ]),
    ends: z.array(pathEnd),
    /** Every fitting the sheet priced, or failed to, with its rule, table and their sources. */
    fittings: z.array(fittingPricingSchema),
    /** The ASHRAE title of every table the sheet was served (`CD3-1  Elbow, Die Stamped, 90 Degree, r/D = 1.5 (…)`), by id. */
    tableTitles: z.record(z.string(), z.string()),
    notes: z.array(sheetNoteSchema),
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
export type DuctsSheetResponse = z.infer<typeof ductsSheetResponseSchema>;
export type DuctsSheetOverview = z.infer<typeof ductsSheetOverviewSchema>;
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
      uniqueId: z.string().min(1),
      portIndex,
      mark: z.string(),
      /** Display disambiguators for a duplicate mark; the UniqueId is identity, never text. */
      level: z.string().nullable().optional(),
      system: z.string().nullable().optional(),
      kind: z.enum(["fan-coil", "air-handler", "erv", "muas", "dehumidifier", "other"]),
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
