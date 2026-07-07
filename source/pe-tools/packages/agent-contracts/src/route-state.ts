/**
 * Route state — the collaborative-UI primitive over AgentController session state.
 *
 * A route that wants pea + human co-editing declares ONE top-level session-state
 * key and a zod schema for what lives under it. Pea's server tools write it via
 * `controllerContext.updateState` (atomic read-modify-write); the browser writes
 * it via `session.setState` (top-level merge) and receives every change through
 * the native `state_changed` event on the existing SSE wire. No per-route server
 * code — routes bring { key, schema }, tool definitions, and UI.
 *
 * Trust semantics are enforced in the tool implementations (pea's tools only
 * write proposals + review marks, never `staged`), not by a generic write mask.
 * ponytail: add a declarative agentWrites mask when a second route needs one.
 */
import { z } from "zod";

export interface RouteStateDef<TSchema extends z.ZodType> {
  /** Top-level session-state key, namespaced `route:<name>` to coexist with harness keys. */
  key: string;
  schema: TSchema;
}

export function defineRouteState<TSchema extends z.ZodType>(
  def: RouteStateDef<TSchema>,
): RouteStateDef<TSchema> {
  return def;
}

/** Parse a route's slice out of a raw session-state map; null when absent or invalid. */
export function readRouteState<TSchema extends z.ZodType>(
  sessionState: Record<string, unknown> | undefined,
  def: RouteStateDef<TSchema>,
): z.infer<TSchema> | null {
  const raw = sessionState?.[def.key];
  if (raw == null) return null;
  const result = def.schema.safeParse(raw);
  return result.success ? result.data : null;
}

/* ── Family sheet ──────────────────────────────────────────────────────────
   The worksheet mirrors the family document open in Revit's family editor:
   parameters × types (formulas as first-class `@formula` cells), with the
   proposal → staged → pushed trichotomy and orthogonal review marks. */

/** Provenance in markdown coordinates — pea never sees a bbox; the UI resolves
 * geometry through the grounded-doc estimator (measured solid / estimated dashed). */
export const sourceRefSchema = z.object({
  blockId: z.string(),
  rowIdx: z.number().nullish(),
  colIdx: z.number().nullish(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const cellProposalSchema = z.object({
  value: z.string(),
  by: z.enum(["pea", "human"]).default("pea"),
  source: sourceRefSchema.nullish(),
  note: z.string().nullish(),
  confidence: z.enum(["high", "low"]).nullish(),
});
export type CellProposal = z.infer<typeof cellProposalSchema>;

export const cellReviewSchema = z.enum(["none", "good", "attention"]);
export type CellReview = z.infer<typeof cellReviewSchema>;

export const cellStateSchema = z.object({
  proposal: cellProposalSchema.nullish(),
  /** Human-promoted value — what push sends. Pea's tools must never write this. */
  staged: z.string().nullish(),
  review: cellReviewSchema.default("none"),
});
export type CellState = z.infer<typeof cellStateSchema>;

export const familySheetParamSchema = z.object({
  name: z.string(),
  isInstance: z.boolean(),
  isReadOnly: z.boolean(),
  isDeterminedByFormula: z.boolean().nullish(),
  isShared: z.boolean().nullish(),
  storageType: z.string(),
  dataType: z.string().nullish(),
  group: z.string().nullish(),
  formula: z.string().nullish(),
  /** typeName -> display-faithful value (AsValueString chain). */
  valuesPerType: z.record(z.string(), z.string()),
});
export type FamilySheetParam = z.infer<typeof familySheetParamSchema>;

export const familySheetSnapshotSchema = z.object({
  familyName: z.string(),
  currentTypeName: z.string().nullish(),
  typeNames: z.array(z.string()),
  parameters: z.array(familySheetParamSchema),
  takenAt: z.string().nullish(),
});
export type FamilySheetSnapshot = z.infer<typeof familySheetSnapshotSchema>;

/** Markdown-only spec-sheet block — geometry (bboxes/screenshots) stays OUT of
 * session state (`state_changed` rebroadcasts the full state on every write);
 * tabs fetch the full grounded view from the parse cache by parseId. */
export const specDocBlockSchema = z.object({
  id: z.string(),
  page: z.number(),
  kind: z.string(),
  md: z.string(),
});
export type SpecDocBlock = z.infer<typeof specDocBlockSchema>;

export const specDocSchema = z.object({
  parseId: z.string().nullish(),
  fileName: z.string(),
  blocks: z.array(specDocBlockSchema),
});
export type SpecDoc = z.infer<typeof specDocSchema>;

export const worksheetSchema = z.object({
  snapshot: familySheetSnapshotSchema.nullish(),
  doc: specDocSchema.nullish(),
  /** worksheetCellKey -> cell trichotomy state. */
  cells: z.record(z.string(), cellStateSchema).default({}),
  pushedAt: z.string().nullish(),
});
export type Worksheet = z.infer<typeof worksheetSchema>;

export const familySheetRouteState = defineRouteState({
  key: "route:family-sheet",
  schema: worksheetSchema,
});

/* ── Cell keys ── `${param}::${type}`; formulas use the `@formula` pseudo-type. */

export const FORMULA_TYPE = "@formula";

export function worksheetCellKey(paramName: string, typeName: string): string {
  return `${paramName}::${typeName}`;
}

export function formulaCellKey(paramName: string): string {
  return worksheetCellKey(paramName, FORMULA_TYPE);
}

export function splitWorksheetCellKey(key: string): { paramName: string; typeName: string } {
  const idx = key.lastIndexOf("::");
  return idx < 0
    ? { paramName: key, typeName: "" }
    : { paramName: key.slice(0, idx), typeName: key.slice(idx + 2) };
}

export function isFormulaCellKey(key: string): boolean {
  return key.endsWith(`::${FORMULA_TYPE}`);
}
