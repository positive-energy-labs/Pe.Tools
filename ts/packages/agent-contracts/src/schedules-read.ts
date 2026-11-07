import { z } from "zod";
import { documentRefSchema } from "./target.ts";
import { scheduleReadingSchema } from "./schedule-actions.ts";
import { scheduleCatalogSchema, scheduleGridRouteState } from "./schedule-grid-data.ts";
import { actionReceiptListDecoder } from "./action-receipts.ts";
import { publicationRequest, publicationSchema } from "./value.ts";
export const schedulesViewArgs = z.object({ target: documentRefSchema, workspaceId: z.string().min(1).nullable() });
export const schedulesViewData = z.object({
  schedulesWork: scheduleGridRouteState.schema,
  catalog: scheduleCatalogSchema,
  reading: scheduleReadingSchema.nullable(),
  saved: scheduleReadingSchema.nullable(),
  receipts: actionReceiptListDecoder(),
  outcome: z.object({unread:z.number(), refused:z.record(z.string(),z.string()),readbackError:z.string().nullable(),receiptId:z.string().nullable()}),
  editRefusal: z.string().nullable(),
});
export const schedulesViewRequest = publicationRequest(schedulesViewArgs);
export const schedulesViewCapability = {
  key: "schedules.view" as const,
  input: schedulesViewArgs.omit({target:true}), output: publicationSchema(schedulesViewData),
  axes: {subject:"Document",touches:["Metadata"],effect:"Read",cost:"Cheap",cardinality:"One"} as const,
};
