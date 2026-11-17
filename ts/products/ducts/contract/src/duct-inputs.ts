import { z } from "zod";
import { decode, subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import { VALUE_SOURCES, validValueSchema, valueResolutionSchema, type ValueResolution } from "@pe/agent-contracts/work-value";
import type { Author } from "@pe/agent-contracts/draft";
import { settingWrittenSchema } from "@pe/agent-contracts/tiered-setting";
import { schemaOf, type Domain } from "@pe/agent-contracts/slots/sheet";
import { DUCT_UNIT_KINDS } from "@pe/host-contracts/generated";
export { DUCT_UNIT_KINDS } from "@pe/host-contracts/generated";
export type { DuctUnitKind } from "@pe/host-contracts/generated";
export type DuctFlow = number;
export const DUCT_PARAMETER_KEYS = ["ratedEsp", "fanFlow", "terminalFlow", "terminalDrop", "componentDrop", "fittingCoefficient"] as const;
const elementId = z.number().int().positive();
const portIndex = z.number().int().nonnegative();
export const elementSubjectSchema: z.ZodType<string> = subjectRefCodeSchema.refine(code => {
  const ref = decode(code); return ref.ok && ref.value.keyKind === "UniqueId";
});

/** Resolved engine inputs expose the winning Work layer and its revision (ADR 0028). */
export const DUCT_INPUT_SOURCES = [...VALUE_SOURCES, "none"] as const;
export type DuctInputSource = (typeof DUCT_INPUT_SOURCES)[number];
/**
 * A resolved input is the kernel resolution itself (`ValueResolution`, work-value.ts): the wire schema
 * is the kernel's schema, so neither can admit a shape the other refuses (P-041).
 */
const resolved = valueResolutionSchema;
export type Resolved<T> = ValueResolution<T>;
/** A value some tier always states (a criterion, a typed table): only the kernel's valid member. */
const stated = validValueSchema;
export type Stated<T> = Extract<Resolved<T>, { status: "valid" }>;
const num = z.number().finite();
const nonneg = num.nonnegative();
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
/** Engine defaults used when no home states a criterion; shared by pricing and sheet cells. */
export const DUCTS_DEFAULT_CRITERIA: DuctsCriteriaValues = {
    velocityLimitFpm: { supply: 900, return: 700 },
    terminalDropInWg: 0.03,
    autoJoinGapIn: 3,
    healBoxIn: 36,
    splitPolicy: "even",
    allowanceInWg: { supply: 0, return: 0 },
  };

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
/**
 * Each criterion's Work cell (ADR 0030 rule 8: one staged value per cell; ruling 2026-11-10, the /ducts
 * design sheet draws one row per cell). A sided criterion is a cell per side; `layer` is where the
 * cell's value sits in the criteria layer the engine resolves over the store and the firm file.
 */
const criterion = <const L extends readonly [keyof DuctsCriteriaLayer, ("supply" | "return")?], const D extends Domain>(layer: L, domain: D) =>
  ({ layer, domain, value: schemaOf(domain), unit: domain.kind === "number" ? domain.unit : undefined });
/** Criteria cell locators and domains feed the same input table as the fan cells. */
export const DUCTS_CRITERIA_CELLS = {
  velocitySupplyFpm: criterion(["velocityLimitFpm", "supply"], { kind: "number", exclusiveMin: 0, unit: "fpm" }),
  velocityReturnFpm: criterion(["velocityLimitFpm", "return"], { kind: "number", exclusiveMin: 0, unit: "fpm" }),
  terminalDropInWg: criterion(["terminalDropInWg"], { kind: "number", min: 0, unit: "in-wg" }),
  autoJoinGapIn: criterion(["autoJoinGapIn"], { kind: "number", min: 0, unit: "in" }),
  healBoxIn: criterion(["healBoxIn"], { kind: "number", min: 0, unit: "in" }),
  splitPolicy: criterion(["splitPolicy"], { kind: "enum", shape: splitPolicy, choices: ["even", "proportional"].map(value => ({ value, label: value })) }),
  allowanceSupplyInWg: criterion(["allowanceInWg", "supply"], { kind: "number", min: 0, unit: "in-wg" }),
  allowanceReturnInWg: criterion(["allowanceInWg", "return"], { kind: "number", min: 0, unit: "in-wg" }),
};

export type DuctsCriteriaCell = keyof typeof DUCTS_CRITERIA_CELLS;
const isCriteriaCell = (cell: string): cell is DuctsCriteriaCell => cell in DUCTS_CRITERIA_CELLS;
/** The criteria layer the cells' staged values make; an unstaged cell leaves its criterion (or side) out. */
export function criteriaLayer(cells: Readonly<Partial<Record<DuctsCriteriaCell, { readonly edit?: { readonly value?: unknown } | null }>>>): DuctsCriteriaLayer {
  const layer: Record<string, unknown> = {};
  for (const [cell, { layer: [key, side] }] of Object.entries(DUCTS_CRITERIA_CELLS)) {
    const value = cells[cell as DuctsCriteriaCell]?.edit?.value;
    if (value === undefined) continue;
    if (side) layer[key] = { ...(layer[key] as object | undefined), [side]: value };
    else layer[key] = value;
  }
  return layer as DuctsCriteriaLayer;
}
/** Who staged each criterion cell and its ref (contract amendment 2): the host-stamped `by`, and the cited ref or the cell's location. A cell with no `by` has no entry, so its criterion resolves invalid. */
export function criteriaMeta(cells: Readonly<Partial<Record<DuctsCriteriaCell, { readonly invalid?: string; readonly edit?: { readonly by?: Author; readonly ref?: string } | null }>>>, work = "duct-systems") {
  const meta: Partial<Record<DuctsCriteriaCell, { by: Author; ref: string } | { invalid: string; ref: string }>> = {};
  for (const cell of Object.keys(DUCTS_CRITERIA_CELLS)) {
    if (!isCriteriaCell(cell)) continue;
    // An unreadable stored criterion keeps its marker, so the resolver holds it invalid instead of falling to the firm value (P-040).
    const invalid = cells[cell]?.invalid;
    if (invalid) { meta[cell] = { invalid, ref: `work:${work}/criteria/${cell}` }; continue; }
    const edit = cells[cell]?.edit;
    if (edit?.by) meta[cell] = { by: edit.by, ref: edit.ref ?? `work:${work}/criteria/${cell}` };
  }
  return meta;
}
/** The cell a criterion (and side) is staged in. */
export const criteriaCellOf = (key: string, side?: string) =>
  (Object.entries(DUCTS_CRITERIA_CELLS).find(([, c]) => c.layer[0] === key && c.layer[1] === side)?.[0] ?? null) as DuctsCriteriaCell | null;
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
export const DUCT_UNIT_ROLES = ["fan", "passive"] as const;
const unitRole = z.enum(DUCT_UNIT_ROLES);
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
    z.string(),
    z.strictObject({ cfm: resolved(nonneg), drop: resolved(nonneg) }),
  ),
  units: z.record(
    z.string(),
    z.strictObject({
      kind: resolved(z.enum(DUCT_UNIT_KINDS)),
      role: resolved(unitRole),
      /** The unit's own design flow; null reads as the sum of the terminals it serves (never an input). */
      cfm: resolved(nonneg),
      esp: resolved(nonneg),
    }),
  ),
  /** An accessory, inline equipment, or a fitting a person priced by hand; null when nothing states a drop. */
  components: z.record(z.string(), z.strictObject({ drop: resolved(nonneg) })),
  rulings: z.strictObject({ joins: z.array(joinRulingSchema), ends: z.array(endRulingSchema) }),
  criteria: z.strictObject({
    velocityLimitFpm: sided(stated(num.positive())),
    terminalDropInWg: stated(nonneg),
    autoJoinGapIn: stated(nonneg),
    healBoxIn: stated(nonneg),
    splitPolicy: stated(splitPolicy),
    allowanceInWg: sided(stated(nonneg)),
  }),
  /** A loss-rule key's ASHRAE table where a person swapped it (Work `rules`). */
  tables: z.record(z.string(), stated(z.string().min(1))),
  /**
   * A fitting family no rule matches, priced as the rule a person assigned (Work `ruleAssignments`).
   * Read only where no rule's own match prices the fitting; a matched fitting keeps its rule.
   */
  assignments: z.record(z.string(), stated(z.string().min(1))),
  /**
   * A typed drop on one path through a proposed fitting (a heal's tee, tap or transition), keyed
   * `proposed:<pair>><toward>` (toward: the main element the branch path continues into, or
   * `straight`). A fallback where no table prices that path; never one number for both paths.
   */
  fittingDrops: z.record(z.string(), stated(nonneg)),
});
export type DuctsInputs = z.infer<typeof ductsInputsSchema>;
/**
 * A home tier's ducts file: `Settings/ducts.json` in the firm home or in a project home (ADR 0037
 * rule 8). It states any subset of the criteria; a criterion it leaves out falls to the next tier,
 * then to the engine default. `written` is the write door's stamp: who last wrote the file, and when.
 */
export const ductsFirmSchema = z.strictObject({
  version: z.string().min(1).optional(),
  criteria: ductsCriteriaLayerSchema.optional(),
  designFriction: z.number().positive().optional(),
  parameters: z.partialRecord(z.enum(DUCT_PARAMETER_KEYS), z.string().min(1)).optional(),
  written: settingWrittenSchema.optional(),
});
export type DuctsFirmFile = z.infer<typeof ductsFirmSchema>;
/**
 * The base layer the engine resolves under Work and the model store: every criterion, with the
 * tier that served each cell. A cell absent from `served` came from the firm file.
 */
export const ductsBaseSchema = z.strictObject({
  version: z.string().min(1),
  criteria: ductsCriteriaValuesSchema,
  served: z.record(z.string(), z.enum(["project", "firm", "default"])).optional(),
});
export type DuctsFirm = z.infer<typeof ductsBaseSchema>;
/**
 * What a cell or Pea writes: Work's own keys, one record per key, `null` deleting the pending edit.
 * The host applies them to document Work and recomputes; nothing here reaches Revit until apply.
 */
const edits = <T extends z.ZodType>(value: T) => z.record(elementSubjectSchema, value.nullable());
export const calcEditsSchema = z.strictObject({
  /**
   * The evidence a caller cites for a value in this same edit, by segment and key; it lands on the
   * cell's `ref` (`CHANGE_META.ref`). The host still stamps who wrote it.
   */
  refs: z.record(z.string(), z.record(elementSubjectSchema, z.string().trim().min(1))).optional(),
  flows: edits(nonneg).optional(),
  terminalDrops: edits(z.strictObject({ inWg: nonneg })).optional(),
  componentDrops: edits(z.strictObject({ inWg: nonneg })).optional(),
  equipmentFlows: edits(nonneg).optional(),
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
/** Every edit the shared sheet engine prices (`editPatches`); each route's door admits only its own Work's keys. */
export type CalcEdits = z.infer<typeof calcEditsSchema>;
const FANS_EDITS = { refs: true, flows: true, terminalDrops: true, componentDrops: true, equipmentFlows: true, roles: true } as const;
/** /ducts' edit door (ruling 2026-11-10, no cross-route write): Ducts Work only; the Fans inputs are /fans' door. */
export const ductsCalcEditsSchema = calcEditsSchema.omit(FANS_EDITS);
export type DuctsCalcEdits = z.infer<typeof ductsCalcEditsSchema>;
/** /fans' edit door (ruling 2026-11-10, no cross-route write): its own cells only; /ducts' keys are refused. */
export const fansCalcEditsSchema = calcEditsSchema.pick(FANS_EDITS);
export type FansCalcEdits = z.infer<typeof fansCalcEditsSchema>;
/** A closure or reading the engine took on its own: shown, never parsed. */
export const calcNoteSchema = z.strictObject({
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
export type CalcNote = z.infer<typeof calcNoteSchema>;

export const ductFirmLineSchema = z.union([
  z.strictObject({ version: z.string(), path: z.string(), present: z.boolean() }),
  z.strictObject({ refused: z.literal("no-shared-root") }),
]);
export type DuctFirmLine = z.infer<typeof ductFirmLineSchema>;
