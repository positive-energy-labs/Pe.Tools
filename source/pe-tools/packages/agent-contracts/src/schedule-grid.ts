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
import { defineRouteState, routeBindingSchema } from "./route-state.ts";
import {
  LOW_CONFIDENCE_REFINE_ERROR,
  lowConfidenceIsFlagged,
  trichotomyAgentMask,
  trichotomyCellSchema,
} from "./trichotomy.ts";

/** String-valued trichotomy cell — no provenance extension (schedule cells have no PDF source). */
export const scheduleGridCellSchema = trichotomyCellSchema(z.string());
export type ScheduleGridCell = z.infer<typeof scheduleGridCellSchema>;

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

export const scheduleGridDocumentSchema = z
  .object({
    binding: routeBindingSchema,
    snapshot: scheduleGridSnapshotSchema.nullish(),
    /** `${rowNumber}::${columnNumber}` -> cell trichotomy state. */
    cells: z.record(z.string(), scheduleGridCellSchema).default({}),
    pushedAt: z.string().nullish(),
  })
  .refine((document) => lowConfidenceIsFlagged(document.cells), {
    error: LOW_CONFIDENCE_REFINE_ERROR,
  });
export type ScheduleGridDocument = z.infer<typeof scheduleGridDocumentSchema>;

export const scheduleGridRouteState = defineRouteState({
  route: "schedule-grid",
  key: "route:schedule-grid",
  schema: scheduleGridDocumentSchema,
  agentWriteMask: trichotomyAgentMask(),
  commands: {
    refresh: {
      description:
        "Read a schedule (by name/id, or the current active view when omitted) into the snapshot with cell binding handles. Existing proposals and review marks are preserved.",
      input: z.object({
        scheduleName: z.string().optional(),
        scheduleId: z.number().int().optional(),
        maxRows: z.number().int().positive().optional(),
        target: z.string().optional(),
      }),
      actor: "any",
    },
    push: {
      description:
        "HUMAN ONLY. Redeem every staged cell's binding handle through revit.apply.parameter-values in one transaction, fold successes into the snapshot, and clear those cells. Failed edits stay staged. With multiple Revit sessions connected, pass target (e.g. 'sandbox:<id>' or 'user').",
      input: z.object({ target: z.string().optional() }),
      actor: "human",
    },
  },
});

export function scheduleCellKey(rowNumber: number, columnNumber: number): string {
  return `${rowNumber}::${columnNumber}`;
}

export function splitScheduleCellKey(key: string): { rowNumber: number; columnNumber: number } {
  const [row, column] = key.split("::");
  return { rowNumber: Number(row), columnNumber: Number(column) };
}
