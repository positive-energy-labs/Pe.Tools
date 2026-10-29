import { z } from "zod";
import { documentRefSchema } from "./target.ts";

const elementId = z.number().int().positive();
const portIndex = z.number().int().nonnegative();
const detail = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("legs"), pathId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("elements") }),
  z.strictObject({ kind: z.literal("inputs") }),
]);
/**
 * Sheet inputs are PER PROJECT (kaitpw ruling R2, 2026-10-28): one document Work cell,
 * `sheetInputs.project`, holds the slot, split policy, join rulings, end rulings, typed drops and
 * typed end cfm that every fan's sheet reads. A join accepted on one fan holds on its sibling.
 * Drops and end cfm are keyed by element id, so they are per element, not per fan.
 * `endRulings` is a second array beside the connector-pair `rulings` (R-CAP, 2026-10-28): the
 * engine and kernel consume `rulings` as `ConnectorPairRuling[]` end to end, so a union there
 * would make every consumer filter; an end ruling names one connector and today has one verdict.
 */
export const ductsSheetInputsSchema = z.strictObject({
  slot: z.string().min(1).optional(),
  splitPolicy: z.enum(["even", "proportional"]).optional(),
  endCfm: z.record(z.string().regex(/^[1-9]\d*$/), z.number().finite().nonnegative()).optional(),
  /**
   * A unit's design flow, cfm, by unit element id: what a side-stream unit (MUAS, ERV) pushes, split
   * across the receiving ends by the split policy (A2). One number instead of a typed share per end.
   */
  unitCfm: z.record(z.string().regex(/^[1-9]\d*$/), z.number().finite().positive()).optional(),
  /** Request-only: element/unit ids whose typed value to remove. The host applies it and never saves it. */
  clear: z
    .strictObject({
      endCfm: z.array(z.string()).optional(),
      drops: z.array(z.string()).optional(),
      unitCfm: z.array(z.string()).optional(),
    })
    .optional(),
  drops: z.record(z.string().regex(/^[1-9]\d*$/), z.number().finite().nonnegative()).optional(),
  rulings: z
    .array(
      z.strictObject({
        pair: z.tuple([z.string().min(1), z.string().min(1)]),
        verdict: z.enum(["accept", "reject"]),
      }),
    )
    .optional(),
  endRulings: z
    .array(
      z.strictObject({
        end: z.strictObject({ elementId, connector: portIndex }),
        verdict: z.literal("capped"),
      }),
    )
    .optional(),
});
/** Stored beside /ducts colours and parameter slots; host passes these through one engine defaults seam. */
export const ductsSheetDefaultsSchema = z.strictObject({
  terminalDropInWg: z.number().finite().nonnegative().optional(),
  autoJoinMaxGapIn: z.number().finite().nonnegative().optional(),
  splitPolicy: z.enum(["even", "proportional"]).optional(),
});
export type DuctsSheetInputs = z.infer<typeof ductsSheetInputsSchema>;

const common = {
  target: documentRefSchema,
  basis: z.string().min(1).optional(),
  detail: detail.optional(),
  inputs: ductsSheetInputsSchema.optional(),
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
    "Read route:ducts.roster with the exact target {session, openId}. Match the equipment mark, then use its unitId and portIndex; marks are not unique. Suggestions remain unconfirmed until the engineer rules.",
    "Read route:ducts.sheet with {target, mode: 'fan', unitId, portIndex}. For a named start and end, use mode 'chain', start {elementId, connector?}, end {elementId}, and asserted direction 'supply' or 'return'. A chain makes no fan ESP claim.",
    "Read the sheet's blockers back to the person with their element and connector, effect on the total, and closer. Report known subtotal, completeness, and required ESP exactly as returned. Never call an incomplete path critical.",
    "Accept or reject a returned heal proposal with the same fan request, its basis, and proposal {pair, verdict}. This writes a calculation ruling to document Work, never a Revit heal. Assumed ESP uses the continued walk; flow and pricing gaps still withhold it. An open end a person rules capped is written as inputs.endRulings [{end: {elementId, connector}, verdict: 'capped'}]; it is then neither an end nor a blocker. A 'sibling-fan' end is another fan sharing the trunk, priced to the junction and carrying none of this fan's flow.",
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
  kind: z.enum(["join", "tap", "tee"]),
  from: z.object({ elementId, connector: portIndex, point: z.array(z.number()).length(3) }),
  to: z.object({
    elementId,
    connector: portIndex.nullable(),
    point: z.array(z.number()).length(3),
  }),
  pair: z.tuple([z.string(), z.string()]),
  gapIn: z.number().nonnegative(),
  fittingChange: z.boolean(),
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
});
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
  }),
});
export const ductsSheetResponseSchema = z.discriminatedUnion("kind", [
  ductsSheetOverviewSchema,
  z.object({ ...responseBase, kind: z.literal("legs"), pathId: z.string(), legs: z.array(leg) }),
  z.object({ ...responseBase, kind: z.literal("elements"), walkedElementIds: z.array(elementId) }),
  z.object({
    ...responseBase,
    kind: z.literal("inputs"),
    edits: ductsSheetInputsSchema,
    ends: z.array(pathEnd),
    inputs: z.array(
      z.object({
        name: z.string(),
        value: z.union([z.number(), z.string(), z.null()]),
        source: z.string(),
      }),
    ),
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
      portIndex,
      mark: z.string(),
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
