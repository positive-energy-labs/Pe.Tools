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
 * - The scene (pressure-drop ledger, 2026-10-19): `subject`, one cell holding an ORDERED element-id
 *   list; `claims`, keyed by claim id, a sentence pinned to element ids with the author's state and a
 *   verdict slot; `labelParameter`, one cell naming the instance parameter whose value names
 *   equipment for people (`ducts.snapshot` reads it into `DuctNode.label`). Pea proposes all three; a
 *   proposed claim never carries a verdict; a staged claim with a verdict is the verdict record.
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

/** The scene's subject: element ids in walking order. The web cuts legs from it (`ducts/legs.ts`). */
const subjectSchema = z.array(z.number().int()).min(1);
export const DUCT_CLAIM_STATES = ["proven", "assumed", "unproven"] as const;
export const DUCT_CLAIM_VERDICTS = ["yes", "no", "not-this"] as const;
/**
 * A sentence about the subject, pinned to element ids. `state` is the author's standing (what the
 * facts prove, what was assumed, what nobody checked); `verdict` is a person's answer, and
 * `verdictBy` / `verdictAt` say who gave it and when. The cell key is the claim id.
 */
export const ductClaimSchema = z
  .strictObject({
    text: z.string().min(1),
    ids: z.array(z.number().int()).min(1),
    state: z.enum(DUCT_CLAIM_STATES),
    verdict: z.enum(DUCT_CLAIM_VERDICTS).optional(),
    verdictBy: z.string().min(1).optional(),
    verdictAt: z.string().optional(),
  })
  .refine((claim) => claim.verdict !== undefined || (!claim.verdictBy && !claim.verdictAt), {
    error: "verdictBy and verdictAt describe a verdict; give one",
  });
export type DuctClaim = z.infer<typeof ductClaimSchema>;

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
    subject: trichotomyCellSchema(subjectSchema).default({}),
    claims: z.record(z.string().min(1), trichotomyCellSchema(ductClaimSchema)).default({}),
    /** The instance parameter whose value names equipment for people; null reads no label. */
    labelParameter: trichotomyCellSchema(z.string().min(1).nullable()).default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.claims))
      if (cell.proposal?.value?.verdict !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["claims", key, "proposal", "value", "verdict"],
          message: "a verdict is a person's answer; a proposed claim carries none",
        });
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
    subject: doc?.subject?.staged?.value ?? null,
    claims: stagedOf<DuctClaim>(doc?.claims ?? {}),
    labelParameter: doc?.labelParameter?.staged?.value ?? null,
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
});
export const ductsApplyInputSchema = z.strictObject({
  slots: slotsSchema.nullable().optional(),
  fittings: z.array(
    z.strictObject({
      id: z.number().int(),
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
    "Duct pressure-drop Work, one trichotomy cell per key. assumptions: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore); flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides, never written to Revit. rules: a loss-rule key holds { table }, the ASHRAE table every instance of that fitting type is looked up under. terminalDrops and componentDrops: an element id holds { inWg, source }. unitStatics: an air mover's element id holds { inWg }, the external static written to it. parameters: fanStatic, fanFlow, componentDrop, terminalDrop name the Revit parameter of each slot (person only). The scene: subject is one cell holding the ordered element ids of the run being explained; claims, keyed by claim id, hold { text, ids, state: proven | assumed | unproven } and, once a person stages one, an optional verdict (yes, no, not-this) with verdictBy and verdictAt; labelParameter is one cell naming the instance parameter whose value names equipment for people. Pea may propose rules, drops, the subject, claims (never with a verdict) and the label parameter; a person stages; ducts.apply-losses writes the staged cells to Revit after ducts.preview-losses.",
  schema: ductsDocumentSchema,
  agentWriteMask: [
    ["assumptions", "*", "proposal"],
    ["rules", "*", "proposal"],
    ["terminalDrops", "*", "proposal"],
    ["componentDrops", "*", "proposal"],
    ["unitStatics", "*", "proposal"],
    ["subject", "proposal"],
    ["claims", "*", "proposal"],
    ["labelParameter", "proposal"],
  ],
  commands: {},
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
