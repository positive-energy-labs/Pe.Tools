/**
 * /ducts Work, every segment a family of trichotomy cells (Pea proposes, a person stages):
 * - `assumptions`, keyed by what the assumption is about: an issue id from the snapshot
 *   (`open-end:g123:456:1`) holds a verdict; `flex-roughness:<flex type>`,
 *   `fan-static:<equipment id>`, `component-drop:<family>` hold overrides. Never written to Revit.
 * - `rules`: loss-rule key (the web's `LOSS_RULES`) -> the ASHRAE table every instance of the rule
 *   is re-looked-up under. A person edits a type's table, never a raw coefficient.
 * - `terminalDrops` (terminal id) and `componentDrops` (fitting or accessory id): a stated drop in
 *   in-wg and where it came from.
 * - `parameters`: which Revit parameter carries each slot; person-only, Pea cannot propose.
 * `ducts.apply` writes the staged rules, drops and slots (and Pe's fan static) to Revit.
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
export const DUCT_SLOTS = ["fanStatic", "fanFlow", "componentDrop", "terminalDrop"] as const;
export type DuctSlot = (typeof DUCT_SLOTS)[number];

const dropSchema = z.strictObject({
  inWg: z.number().nonnegative(),
  /** Where the number came from: a catalog page, a submittal, "rule of thumb". */
  source: z.string().optional(),
});
export type DuctDrop = z.infer<typeof dropSchema>;
const elementKey = z.string().regex(/^\d+$/, { error: "a drop cell key is an element id" });

export const ductsDocumentSchema = z
  .strictObject({
    assumptions: z.record(z.string(), trichotomyCellSchema(ductAssumptionSchema)).default({}),
    rules: z
      .record(z.string(), trichotomyCellSchema(z.strictObject({ table: z.string().min(1) })))
      .default({}),
    terminalDrops: z.record(elementKey, trichotomyCellSchema(dropSchema)).default({}),
    componentDrops: z.record(elementKey, trichotomyCellSchema(dropSchema)).default({}),
    parameters: z
      .partialRecord(z.enum(DUCT_SLOTS), trichotomyCellSchema(z.string().min(1)))
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
    parameters: stagedOf(doc?.parameters ?? {}) as Partial<Record<DuctSlot, string>>,
  };
}

/**
 * What `ducts.preview` and `ducts.apply` send (`previewOnly` is the verb's). Built by the web from
 * the staged cells and Pe's own lookup: one fitting row per instance of a staged rule, under the
 * rule's chosen table; the equipment row is Pe's fan static for the group's air mover, through the
 * `fanStatic` slot. `store` is the provenance blob Revit keeps in Project Information.
 */
const writeDrop = z.strictObject({
  id: z.number().int(),
  inWg: z.number().nonnegative(),
  source: z.string().nullable(),
});
export const ductsApplyInputSchema = z.strictObject({
  slots: z.partialRecord(z.enum(DUCT_SLOTS), z.string().min(1)),
  fittings: z.array(
    z.strictObject({
      id: z.number().int(),
      coefficient: z.number(),
      table: z.string().min(1),
      inputs: z.string(),
      ruleKey: z.string().min(1),
    }),
  ),
  terminals: z.array(writeDrop),
  components: z.array(writeDrop),
  equipment: z.array(
    z.strictObject({ id: z.number().int(), externalStaticInWg: z.number().nonnegative() }),
  ),
  networkBasedCalculations: z.boolean(),
  store: z.strictObject({
    version: z.literal(1),
    rules: z.record(z.string(), z.string()),
    instances: z.record(
      z.string(),
      z.strictObject({ ruleKey: z.string(), table: z.string(), coefficient: z.number() }),
    ),
    terminals: z.record(z.string(), dropSchema),
    slots: z.partialRecord(z.enum(DUCT_SLOTS), z.string()),
    workRevision: z.number().int().nonnegative(),
    appliedAt: z.iso.datetime({ offset: true }),
  }),
});
export type DuctsApplyInput = z.infer<typeof ductsApplyInputSchema>;

export const ductsRouteState = {
  route: "ducts",
  title: "Ducts",
  description:
    "Duct pressure-drop Work, one trichotomy cell per key. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore); flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. terminalDrops and componentDrops: an element id holds { inWg, source }. parameters: fanStatic, fanFlow, componentDrop, terminalDrop name the Revit parameter of each slot (person only). Pea may propose rules and drops; a person stages; ducts.apply writes the staged cells to Revit after a preview.",
  schema: ductsDocumentSchema,
  agentWriteMask: [
    ["assumptions", "*", "proposal"],
    ["rules", "*", "proposal"],
    ["terminalDrops", "*", "proposal"],
    ["componentDrops", "*", "proposal"],
  ],
  commands: {},
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
