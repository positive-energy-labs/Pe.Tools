/**
 * /ducts Work, every segment a family of trichotomy cells (Pea proposes, a person stages):
 * - `assumptions`, keyed by what the assumption is about: an issue id from the snapshot
 *   (`open-end:g123:456:1`) holds a verdict; `flex-roughness:<flex type>`,
 *   `fan-static:<equipment id>`, `component-drop:<family>` hold overrides. Never written to Revit.
 * - `rules`: loss-rule key (the web's `LOSS_RULES`) -> the ASHRAE table every instance of the rule
 *   is re-looked-up under. A person edits a type's table, never a raw coefficient.
 * - `terminalDrops` (terminal id) and `componentDrops` (fitting or accessory id): a stated drop in
 *   in-wg and where it came from.
 * - `unitStatics` (air mover id): the external static Pe writes to a unit, in in-wg.
 * - `parameters`: which Revit parameter carries each slot; person-only, Pea cannot propose.
 * `ducts.apply` writes the staged rules, drops, unit statics and slots to Revit.
 */
import { z } from "zod";

import { type RouteStateSpec } from "./route-state.ts";
import { trichotomyCellSchema } from "./trichotomy.ts";

export const ductAssumptionSchema = z.discriminatedUnion("kind", [
  /** capped: the open end carries no flow; connect: it must be connected in the model; ignore: leave it out. */
  z.strictObject({ kind: z.literal("verdict"), verdict: z.enum(["capped", "connect", "ignore"]) }),
  z.strictObject({ kind: z.literal("flex-roughness"), ft: z.number().positive() }),
  z.strictObject({ kind: z.literal("fan-static"), inWg: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal("component-drop"), inWg: z.number().nonnegative() }),
]);
export type DuctAssumption = z.infer<typeof ductAssumptionSchema>;

const OVERRIDES = ["flex-roughness", "fan-static", "component-drop"] as const;
export type DuctOverrideKind = (typeof OVERRIDES)[number];

/** The cell key of an override: `<kind>:<subject>`. Any other key is an issue id and holds a verdict. */
export const ductOverrideKey = (kind: DuctOverrideKind, subject: string | number) =>
  `${kind}:${subject}`;
const kindOfKey = (key: string): DuctAssumption["kind"] => {
  const head = key.slice(0, key.indexOf(":"));
  return (OVERRIDES as readonly string[]).includes(head) ? (head as DuctOverrideKind) : "verdict";
};

/** The parameter slots `ducts.snapshot` reads and `ducts.apply` writes through. */
export const DUCT_PARAMETER_KEYS = [
  "fanStatic",
  "fanFlow",
  "componentDrop",
  "terminalDrop",
  "fittingCoefficient",
] as const;
export type DuctParameterKey = (typeof DUCT_PARAMETER_KEYS)[number];

const dropSchema = z.strictObject({
  inWg: z.number().nonnegative(),
  /** Where the number came from: a catalog page, a submittal, "rule of thumb". */
  source: z.string().optional(),
});
export type DuctDrop = z.infer<typeof dropSchema>;
/** The external static Pe writes to an air mover (a unit id key); staged only, never a side effect. */
const unitStaticSchema = z.strictObject({ inWg: z.number().nonnegative() });
const elementKey = z.string().regex(/^\d+$/, { error: "a drop cell key is an element id" });

export const ductsDocumentSchema = z
  .strictObject({
    assumptions: z.record(z.string(), trichotomyCellSchema(ductAssumptionSchema)).default({}),
    rules: z
      .record(z.string(), trichotomyCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    terminalDrops: z.record(elementKey, trichotomyCellSchema(dropSchema)).default({}),
    componentDrops: z.record(elementKey, trichotomyCellSchema(dropSchema)).default({}),
    unitStatics: z.record(elementKey, trichotomyCellSchema(unitStaticSchema)).default({}),
    parameters: z
      .partialRecord(z.enum(DUCT_PARAMETER_KEYS), trichotomyCellSchema(z.string().min(1)))
      .default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.assumptions))
      for (const rung of ["proposal", "staged"] as const) {
        const value = cell[rung]?.value;
        if (value && value.kind !== kindOfKey(key))
          ctx.addIssue({
            code: "custom",
            path: ["assumptions", key, rung, "value"],
            message: `the key ${key} holds a ${kindOfKey(key)}, not a ${value.kind}`,
          });
      }
  });
export type DuctsRouteDocument = z.infer<typeof ductsDocumentSchema>;

const stagedOf = <V>(cells: Record<string, { staged?: { value?: V } | null } | undefined>) =>
  Object.fromEntries(
    Object.entries(cells).flatMap(([key, cell]) =>
      cell?.staged?.value === undefined ? [] : [[key, cell.staged.value]],
    ),
  ) as Record<string, V>;

/** The person's staged values only, per segment; proposals never reach Revit. */
export function stagedDucts(doc: DuctsRouteDocument | null) {
  return {
    rules: stagedOf(doc?.rules ?? {}),
    terminalDrops: stagedOf(doc?.terminalDrops ?? {}),
    componentDrops: stagedOf(doc?.componentDrops ?? {}),
    unitStatics: stagedOf(doc?.unitStatics ?? {}),
    parameters: stagedOf(doc?.parameters ?? {}) as Partial<Record<DuctParameterKey, string>>,
  };
}

/**
 * What `ducts.preview-losses` and `ducts.apply-losses` send; the host adds `previewOnly` and calls
 * the native `ducts.apply`. Mirrors the generated `DuctsApply.Req.Request` field for field (the web
 * test pins the two types to each other). Built by the web from the staged cells and Pe's own
 * lookup: one fitting row per instance of a staged rule under the rule's chosen table; the
 * equipment rows are the staged `unitStatics`, through the `fanStatic` slot.
 */
const optionalText = z.string().nullable().optional();
const writeDrop = z.strictObject({
  id: z.number().int(),
  inWg: z.number().nonnegative(),
  source: optionalText,
});
const slotsSchema = z.strictObject({
  fanStatic: z.string().min(1).optional(),
  fanFlow: z.string().min(1).optional(),
  componentDrop: z.string().min(1).optional(),
  terminalDrop: optionalText,
  /** The fitting family's own coefficient parameter the Pe loss server reads (default Pe_C). */
  fittingCoefficient: z.string().min(1).optional(),
});
/**
 * How Revit is told a fitting's loss (pressure-drop ledger, 2026-10-12): the Pe loss server charges the
 * family's coefficient when it has one, else prices the legs live from the rule's table; a frozen
 * Specific Coefficient is the export route and never the web's. Revit's own table route is never written.
 */
export const DUCT_FITTING_METHODS = ["pe-server", "specific-coefficient"] as const;
export type DuctFittingMethod = (typeof DUCT_FITTING_METHODS)[number];
export const ductsApplyInputSchema = z.strictObject({
  slots: slotsSchema.nullable().optional(),
  fittings: z.array(
    z.strictObject({
      id: z.number().int(),
      method: z.enum(DUCT_FITTING_METHODS),
      coefficient: z.number(),
      table: optionalText,
      inputs: optionalText,
      ruleKey: optionalText,
    }),
  ),
  terminals: z.array(writeDrop),
  components: z.array(writeDrop),
  equipment: z.array(
    z.strictObject({ id: z.number().int(), externalStaticInWg: z.number().nonnegative() }),
  ),
  /**
   * The whole provenance store after this apply (`DuctLossStore` v1): the model's store, its
   * unknown keys passed through, with this apply's rules, instances and drops over it, since the
   * native op writes it as sent. `workRevision` is the model store's revision as read; an older
   * one refuses as stale.
   */
  store: z.looseObject({
    /** 1; the native op refuses any other store version. */
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
    slots: slotsSchema.nullable().optional(),
    workRevision: z.number().int().nonnegative().optional(),
    appliedAt: optionalText,
  }),
});
export type DuctsApplyInput = z.infer<typeof ductsApplyInputSchema>;

export const ductsRouteState = {
  route: "ducts",
  title: "Ducts",
  description:
    "Duct pressure-drop Work, one trichotomy cell per key. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore); flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. terminalDrops and componentDrops: an element id holds { inWg, source }. unitStatics: an air mover's element id holds { inWg }, the external static written to it. parameters: fanStatic, fanFlow, componentDrop, terminalDrop, fittingCoefficient name the Revit parameter of each slot (person only); fittingCoefficient is the family parameter the Pe loss server reads (default Pe_C). Pea may propose rules and drops; a person stages; ducts.apply-losses writes the staged cells to Revit after ducts.preview-losses.",
  schema: ductsDocumentSchema,
  agentWriteMask: [
    ["assumptions", "*", "proposal"],
    ["rules", "*", "proposal"],
    ["terminalDrops", "*", "proposal"],
    ["componentDrops", "*", "proposal"],
    ["unitStatics", "*", "proposal"],
  ],
  commands: {},
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
