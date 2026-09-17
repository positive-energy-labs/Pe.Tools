import { z } from "zod";
import { addressSchema, documentRefSchema } from "./target.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { scheduleGridSnapshotSchema } from "./schedule-grid-data.ts";
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
export const scheduleActions = {
  "schedule.grid.push": {
    says: "Push reviewed staged schedule cells using their frozen bindings. Complete positive native acknowledgments precede conditional Work publication and actual readback.",
    needs: "project-document",
    actor: "human",
    dirties: ["schedules"],
    executors: ["revit.apply.parameter-values"],
    description:
      "Push reviewed staged schedule cells using their frozen bindings. Complete positive native acknowledgments precede conditional Work publication and actual readback.",
    input: z.object({}),
  },
  "schedule.capture": {
    says: "Capture one schedule as a new spec member in the route's pod; returns the member address and sha256.",
    needs: "project-document",
    actor: "any",
    dirties: ["pods"],
    executors: ["schedule.capture", "pod.member.write"],
    description:
      "Capture one schedule as a new spec member in the route's pod; returns the member address and sha256.",
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
