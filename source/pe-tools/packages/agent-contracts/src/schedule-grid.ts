/**
 * /schedule-grid document — collaborative state for editing schedule cells.
 *
 * Fourth trichotomy instance: the snapshot mirrors one rendered Revit schedule
 * (columns × rows with cell binding handles from revit.detail.schedules
 * projection.includeBindings); cells carry proposal → staged → pushed state keyed
 * `${rowNumber}::${columnNumber}`. The human-only `push` command redeems each staged
 * cell's binding handle (target element ids + parameter id) through
 * revit.apply.parameter-values in one host-owned transaction.
 */
import { z } from "zod";
import type { RouteStateSpec } from "./route-state.ts";
import { trichotomyAgentMask, trichotomyCellSchema } from "./trichotomy.ts";

/** String-valued trichotomy cell — no provenance extension (schedule cells have no PDF source). */
export const scheduleGridCellSchema = trichotomyCellSchema(z.string());
export type ScheduleGridCell = z.infer<typeof scheduleGridCellSchema>;

/* ── Catalog (revit.catalog.schedules, Summary) — every schedule in the document ── */

export const scheduleCatalogEntrySchema = z.object({
  scheduleId: z.number().int(),
  name: z.string(),
  categoryName: z.string().nullish(),
  rowCount: z.number().int().default(0),
  isPlacedOnSheet: z.boolean().default(false),
});
export type ScheduleCatalogEntry = z.infer<typeof scheduleCatalogEntrySchema>;

export const scheduleCatalogSchema = z.object({
  documentTitle: z.string().nullish(),
  schedules: z.array(scheduleCatalogEntrySchema),
  takenAt: z.string().nullish(),
});
export type ScheduleCatalog = z.infer<typeof scheduleCatalogSchema>;

/* ── Snapshot (revit.detail.schedules, Rows + includeBindings) ─────────────── */

export const scheduleColumnSchema = z.object({
  columnNumber: z.number().int(),
  headerText: z.string(),
  fieldName: z.string(),
  isCalculated: z.boolean().default(false),
  isCombinedParameter: z.boolean().default(false),
});
export type ScheduleColumn = z.infer<typeof scheduleColumnSchema>;

/** The write surface behind one rendered cell — the binding handle push redeems. */
export const scheduleCellBindingSchema = z.object({
  columnNumber: z.number().int(),
  targetElementIds: z.array(z.number().int()).default([]),
  parameterName: z.string().nullish(),
  parameterId: z.number().int().nullish(),
  storageType: z.string(),
  displayValue: z.string().nullish(),
  isTypeParameter: z.boolean().default(false),
  isEditable: z.boolean().default(false),
  /** Why the cell is not writable (None when it is). */
  blocker: z.string().default("None"),
  hasMixedValues: z.boolean().default(false),
});
export type ScheduleCellBinding = z.infer<typeof scheduleCellBindingSchema>;

export const scheduleRowSchema = z.object({
  rowNumber: z.number().int(),
  kind: z.string().default("Data"),
  values: z.array(z.string()).default([]),
  subjectIds: z.array(z.number().int()).default([]),
  bindings: z.array(scheduleCellBindingSchema).default([]),
});
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

export const scheduleGridSnapshotSchema = z.object({
  scheduleId: z.number().int(),
  scheduleUniqueId: z.string().nullish(),
  scheduleName: z.string(),
  documentTitle: z.string().nullish(),
  columns: z.array(scheduleColumnSchema),
  rows: z.array(scheduleRowSchema),
  truncated: z.boolean().default(false),
  takenAt: z.string().nullish(),
});
export type ScheduleGridSnapshot = z.infer<typeof scheduleGridSnapshotSchema>;

/* ── The document ──────────────────────────────────────────────────────────── */

/** Authored Work for one schedule subject. Readings are immutable references, not editable facts. */
export const scheduleGridDocumentSchema = z.object({
  basis: z.object({ captureId: z.string().regex(/^[a-f0-9]{64}$/) }).nullish(),
  cells: z.record(z.string(), scheduleGridCellSchema).default({}),
});
export type ScheduleGridDocument = z.infer<typeof scheduleGridDocumentSchema>;
export const scheduleGridRouteState = {
  route: "schedule-grid",
  title: "Schedule Grid",
  description:
    "Review schedule cell edits. Read op:schedule-grid.snapshot for the subject Work address and binding basis; only humans apply.",
  schema: scheduleGridDocumentSchema,
  agentWriteMask: trichotomyAgentMask(),
  commands: {},
} satisfies RouteStateSpec<typeof scheduleGridDocumentSchema>;

export function scheduleCellKey(rowNumber: number, columnNumber: number): string {
  return `${rowNumber}::${columnNumber}`;
}

export function splitScheduleCellKey(key: string): { rowNumber: number; columnNumber: number } {
  const [row, column] = key.split("::");
  return { rowNumber: Number(row), columnNumber: Number(column) };
}
