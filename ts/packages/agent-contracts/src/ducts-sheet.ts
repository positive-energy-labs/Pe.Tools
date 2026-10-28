import { z } from "zod";
import { documentRefSchema } from "./target.ts";

const elementId = z.number().int().positive();
const portIndex = z.number().int().nonnegative();
const detail = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("legs"), pathId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("elements") }),
  z.strictObject({ kind: z.literal("inputs") }),
]);
/** Project slot is shared by all fan sheets. Other inputs are retained per fan/chain subject. */
export const ductsSheetInputsSchema = z.strictObject({
  slot: z.string().min(1).optional(),
  splitPolicy: z.enum(["even", "proportional"]).optional(),
  endCfm: z.record(z.string().regex(/^[1-9]\d*$/), z.number().finite().nonnegative()).optional(),
  drops: z.record(z.string().regex(/^[1-9]\d*$/), z.number().finite().nonnegative()).optional(),
  rulings: z.array(z.strictObject({ pair: z.tuple([z.string().min(1), z.string().min(1)]), verdict: z.enum(["accept", "reject"]) })).optional(),
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
  kind: z.enum(["terminal", "open-end", "roster-fan-port", "joins-other-fan"]),
  elementId,
  connector: portIndex.optional(),
  fan: fanRef.nullable().optional(),
});
const sideTotals = z.object({
  worstPath: z.number().nullable(),
  knownInWg: z.number(),
  allowanceInWg: z.number(),
  complete: z.boolean(),
  telFt: z.number(),
  frictionRatePer100: z.number().nullable(),
});
const totals = z.object({
  supply: sideTotals,
  return: sideTotals,
  requiredEspInWg: z.number().nullable(),
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
  owner: fanRef.optional(),
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
        }),
      }),
    ),
  }),
]);
export type DuctsSheetResponse = z.infer<typeof ductsSheetResponseSchema>;
export type DuctsSheetOverview = z.infer<typeof ductsSheetOverviewSchema>;
export const ductsRosterResponseSchema = z.object({
  target: documentRefSchema,
  slots: z.array(z.object({ slot: z.string(), covered: z.number().int().nonnegative(), total: z.number().int().nonnegative() })),
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
      complete: z.boolean().optional(),
    }),
  ),
});
export type DuctsRosterResponse = z.infer<typeof ductsRosterResponseSchema>;
