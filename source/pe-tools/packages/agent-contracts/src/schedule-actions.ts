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
 * A successful read of this Work's schedule rebinds it, in one write: `basis` moves to `reading`
 * (its live document lifetime). A staged cell whose binding differs between the old basis and
 * `reading`, or whose old basis is unreadable (`null`), is stale: its value returns to a human
 * proposal that says so, and approving it stages it again under the new basis. The rest stay staged
 * and push against `reading`. Nothing is dropped and nothing stays under the old binding.
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
  const patches: RouteStatePatch[] = [{ path: ["basis"], value: { captureId: reading.id } }];
  for (const [key, cell] of Object.entries(doc.cells)) {
    if (!cell.staged) continue;
    const before = binding(basis, key),
      after = binding(reading, key);
    if (before && after && canonicalRouteInput(before) === canonicalRouteInput(after)) continue;
    const pea = cell.proposal ? `; replaces pea's proposal "${String(cell.proposal.value)}"` : "";
    patches.push(
      { path: ["cells", key, "staged"] },
      {
        path: ["cells", key, "proposal"],
        value: {
          value: cell.staged.value,
          by: "human",
          note: `stale: Revit changed under this cell since you staged it (${before?.displayValue ?? "?"} → ${after ? (after.displayValue ?? "—") : "no binding"}); approve to stage it again${pea}`,
        },
      },
    );
  }
  return patches;
}
export const scheduleActions = {
  "schedule.grid.push": {
    says: "Push reviewed staged schedule cells using their frozen bindings. Complete positive native acknowledgments precede conditional Work publication and actual readback. Files a run receipt (values before and after) in the bound pod, or in the action receipt when no pod is bound.",
    needs: "project-document",
    actor: "human",
    dirties: ["schedules", "pods"],
    executors: ["schedule.cells.apply", "pod.run.write"],
    description:
      "Push reviewed staged schedule cells using their frozen bindings. Complete positive native acknowledgments precede conditional Work publication and actual readback. Files a run receipt (values before and after) in the bound pod, or in the action receipt when no pod is bound.",
    input: z.object({ pod: z.string().min(1).optional() }),
  },
  "schedule.capture": {
    says: "Capture one schedule as a new spec member in the route's pod and write its run; returns the member address, sha256, and run.",
    needs: "project-document",
    actor: "any",
    dirties: ["pods"],
    executors: ["schedule.capture", "pod.member.write"],
    description:
      "Capture one schedule as a new spec member in the route's pod and write its run; returns the member address, sha256, and run.",
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
    description:
      "Apply a saved schedule spec to the target document. Creates a new schedule every time and writes a run receipt.",
    input: z.object({ source: podMemberSourceSchema }),
  },
} as const;
export const scheduleReads = {
  "schedule.grid.catalog": {
    says: "Read schedules from the exact selected document without changing authored Work.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    description: "Read schedules from the exact selected document without changing authored Work.",
    input: z.object({}),
  },
  "schedule.grid.snapshot": {
    says: "Read one schedule and its bindings. Returns immutable reading ID and subject workspaceId. Read/propose route:schedules with this workspaceId; stage against basis.captureId. Reading never deletes cells.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "project-document",
    actor: "any",
    description:
      "Read one schedule and its bindings. Returns immutable reading ID and subject workspaceId. Read/propose route:schedules with this workspaceId; stage against basis.captureId. Reading never deletes cells.",
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
    description:
      "Read the latest retained schedule reading for a subject Work address. This is dated evidence, not a fresh native read.",
    input: z.object({ workspaceId: z.string().min(1) }),
  },
  "schedule.grid.saved": {
    says: "Read an original immutable schedule snapshot and its exact target without Revit.",
    dirties: [], // TODO(fold-1): name the Readings this action invalidates
    needs: "nothing",
    actor: "any",
    description: "Read an original immutable schedule snapshot and its exact target without Revit.",
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
} as const;
export type ScheduleReadKey = keyof typeof scheduleReads;
