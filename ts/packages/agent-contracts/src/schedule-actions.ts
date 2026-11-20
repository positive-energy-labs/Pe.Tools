import type { Command } from "./command.ts";
import { z } from "zod";
import { addressSchema, documentRefSchema } from "./target.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { scheduleGridSnapshotSchema } from "./schedule-grid-data.ts";

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

export const scheduleReadingRoute = "schedules.readings";
export const scheduleReads = {
  "schedule.grid.catalog": {
    via: { route: scheduleReadingRoute },
    catalogEffect: "Read",
    says: "Read schedules from the exact selected document without changing authored Work.",
    dirties: [],
    needs: "project-document",
    effect: "query",
    input: z.object({}),
  },
  "schedule.grid.snapshot": {
    via: { route: "schedules.readings" },
    catalogEffect: "Read",
    says: "Read one schedule and its bindings. Returns an immutable reading ID and the workspace ID used to find retained snapshots.",
    dirties: [],
    needs: "project-document",
    effect: "query",
    input: z.object({
      scheduleId: z.number().int().optional(),
      scheduleName: z.string().optional(),
      maxRows: z.number().int().min(1).max(2000).default(200),
    }),
  },
  "schedule.grid.work": {
    via: { route: "schedules.readings" },
    catalogEffect: "Read",
    says: "Read the latest retained schedule reading for a subject Work address, or null when none is retained. This is dated evidence, not a fresh native read.",
    dirties: [],
    needs: "nothing",
    effect: "query",
    input: z.object({ workspaceId: z.string().min(1) }),
  },
  "schedule.grid.history": {
    via: { route: "schedules.readings" },
    catalogEffect: "Read",
    says: "List every retained schedule reading of a subject Work address, newest first: its History. Each row's id opens with schedule.grid.saved.",
    dirties: [],
    needs: "nothing",
    effect: "query",
    input: z.object({ workspaceId: z.string().min(1) }),
  },
  "schedule.grid.saved": {
    via: { route: "schedules.readings" },
    catalogEffect: "Read",
    says: "Read an original immutable schedule snapshot and its exact target without Revit.",
    dirties: [],
    needs: "nothing",
    effect: "query",
    input: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  },
} as const satisfies Record<string, Command>;
export type ScheduleReadKey = keyof typeof scheduleReads;
