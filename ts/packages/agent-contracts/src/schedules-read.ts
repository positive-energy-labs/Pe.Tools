import { z } from "zod";
import { documentReadTargetSchema } from "./target.ts";
import { scheduleReadingSchema } from "./schedule-actions.ts";
import { scheduleCatalogSchema, scheduleGridRouteState } from "./schedule-grid-data.ts";
import { valueRead } from "./value.ts";
export const schedulesViewArgs = z.object({
  target: documentReadTargetSchema,
  workspaceId: z.string().min(1).nullable(),
});
export const schedulesViewData = z.object({
  schedulesWork: scheduleGridRouteState.schema,
  catalog: scheduleCatalogSchema,
  reading: scheduleReadingSchema.nullable(),
  saved: scheduleReadingSchema.nullable(),
  outcome: z.object({
    unread: z.number(),
    refused: z.record(z.string(), z.string()),
    readbackError: z.string().nullable(),
    receiptId: z.string().nullable(),
  }),
  editRefusal: z.string().nullable(),
});
export const schedulesViewCapability = valueRead(
  "schedules.view",
  schedulesViewArgs.omit({ target: true }),
  schedulesViewData,
);
