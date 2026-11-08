import { z } from "zod";
import {
  takeoffsRouteState,
  takeoffObservationSchema,
  takeoffCaptureSchema,
  takeoffCaptureSummarySchema,
  candidateRegionSchema,
  commands,
  workHandleSchema,
} from "@pe/agent-contracts";
export const adoptionArgs = z.object({
  views: z.union([z.array(z.string()), z.literal("all")]),
  zones: z.union([z.array(z.string()), z.literal("all")]),
  work: z.string(),
});
export const viewCatalogueArgs = z.object({ work: z.string() });
export const viewCatalogueData = z.object({
  viewOptions: z.array(z.object({ id: z.string(), label: z.string() })),
  capturedViews: z.array(z.object({ name: z.string(), level: z.string() })),
});
export const adoptionData = z.object({
  takeoffWork: takeoffsRouteState.schema,
  handle: workHandleSchema.nullable(),
  views: z.array(z.string()),
  viewOptions: z.array(z.object({ id: z.string(), label: z.string() })),
  observation: takeoffObservationSchema.nullable(),
  saved: takeoffCaptureSchema.nullable(),
  captures: z.array(takeoffCaptureSummarySchema),
  rows: z.array(
    z.object({
      region: candidateRegionSchema,
      view: z.string(),
      checked: z.boolean(),
      name: z.string(),
      systemTag: z.string(),
    }),
  ),
  initialize: z.object({
    request: commands["takeoffs.initialize"].authoredInput,
    refusal: z.string().nullable(),
  }),
  adopt: z.object({
    request: commands["takeoffs.adopt"].authoredInput.nullable(),
    refusal: z.string().nullable(),
  }),
});
