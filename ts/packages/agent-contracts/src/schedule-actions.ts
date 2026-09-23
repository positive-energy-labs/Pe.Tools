import type { ActionDefinition } from "./semantic-actions.ts";
import { z } from "zod";
import { addressSchema, documentRefSchema } from "./target.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import {
  scheduleGridSnapshotSchema,
  splitScheduleCellKey,
  type ScheduleGridDocument,
} from "./schedule-grid-data.ts";
import { canonicalRouteInput } from "./route-doc.ts";
import type { RouteStatePatch } from "./route-state.ts";
import { podMemberSourceSchema } from "./settings.ts";

export const scheduleReadingSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string(),
  target: documentRefSchema,
  process: nativeProcessSchema,
  document: addressSchema,
  workspaceId: z.string().min(1),
  snapshot: scheduleGridSnapshotSchema,
});
export type ScheduleReading = z.infer<typeof scheduleReadingSchema>;

/**
 * A person's read of this Work's schedule, or a push's readback, rebinds it in ONE write: `basis`
 * moves to `reading` (its live document lifetime) and names in `basis.stale` every staged cell whose
 * binding differs between the old basis and `reading` (or whose old basis is unreadable), with the
 * display value it was reviewed against, plus any cell still stale from before (keeping its first
 * `was`). Cells are untouched; push refuses a stale key per cell, and staging or unstaging the key
 * drops it (`unstale`).
 */
export function rebindScheduleWork(
  doc: ScheduleGridDocument,
  basis: ScheduleReading | null,
  reading: ScheduleReading,
): RouteStatePatch[] {
  if (!doc.basis || doc.basis.captureId === reading.id) return [];
  const binding = (at: ScheduleReading | null, key: string) => {
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    return at?.snapshot.rows
      .find((row) => row.rowNumber === rowNumber)
      ?.bindings.find((b) => b.columnNumber === columnNumber);
  };
  const already = new Map((doc.basis.stale ?? []).map((cell) => [cell.key, cell.was]));
  const stale = Object.entries(doc.cells).flatMap(([key, cell]) => {
    if (!cell.staged) return [];
    if (already.has(key)) return [{ key, was: already.get(key)! }];
    const before = binding(basis, key),
      after = binding(reading, key);
    return !before || !after || canonicalRouteInput(before) !== canonicalRouteInput(after)
      ? [{ key, was: before?.displayValue ?? null }]
      : [];
  });
  return [
    { path: ["basis"], value: { captureId: reading.id, ...(stale.length ? { stale } : {}) } },
    { path: ["takenAt"], value: reading.capturedAt },
  ];
}

/** The patch that drops `keys` from `basis.stale` when a write stages or unstages them. */
export function unstale(
  doc: ScheduleGridDocument | null,
  keys: readonly string[],
): RouteStatePatch[] {
  const stale = doc?.basis?.stale ?? [];
  const rest = stale.filter((cell) => !keys.includes(cell.key));
  if (rest.length === stale.length) return [];
  return [rest.length ? { path: ["basis", "stale"], value: rest } : { path: ["basis", "stale"] }];
}
export const scheduleActions = {
  "schedule.grid.push": {
    says: "Push reviewed staged schedule cells using their frozen bindings. Complete positive native acknowledgments precede conditional Work publication and actual readback. Files a run receipt (values before and after) in the bound pod, or in the action receipt when no pod is bound.",
    needs: "project-document",
    actor: "human",
    dirties: ["schedules", "pods"],
    executors: ["schedule.cells.apply", "pod.run.write"],
    input: z.object({ pod: z.string().min(1).optional() }),
  },
  "schedule.capture": {
    says: "Capture one schedule as a new spec member in the route's pod and write its run; returns the member address, sha256, and run.",
    needs: "project-document",
    actor: "any",
    dirties: ["pods"],
    executors: ["schedule.capture", "pod.member.write"],
    input: z.object({
      pod: z.string().min(1),
      path: z.string().min(1).optional(),
      scheduleId: z.number().int(),
    }),
  },
  "schedule.apply": {
    says: "Apply a saved schedule spec to the target document. Creates a new schedule every time and writes a run receipt.",
    needs: "project-document",
    actor: "human",
    dirties: ["pods"],
    executors: ["pod.member.compose", "schedule.apply"],
    input: z.object({ source: podMemberSourceSchema }),
  },
} as const;
export const scheduleReads = {
  "schedule.grid.catalog": {
    says: "Read schedules from the exact selected document without changing authored Work.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    input: z.object({}),
  },
  "schedule.grid.snapshot": {
    says: "Read one schedule and its bindings. Returns immutable reading ID and subject workspaceId. Read/propose route:schedules with this workspaceId; stage against basis.captureId. Reading never deletes cells.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    input: z.object({
      scheduleId: z.number().int().optional(),
      scheduleName: z.string().optional(),
      maxRows: z.number().int().min(1).max(2000).default(200),
    }),
  },
  "schedule.grid.work": {
    says: "Read the latest retained schedule reading for a subject Work address. This is dated evidence, not a fresh native read.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "nothing",
    actor: "any",
    input: z.object({ workspaceId: z.string().min(1) }),
  },
  "schedule.grid.saved": {
    says: "Read an original immutable schedule snapshot and its exact target without Revit.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
} as const satisfies Record<string, ActionDefinition>;
export type ScheduleReadKey = keyof typeof scheduleReads;
