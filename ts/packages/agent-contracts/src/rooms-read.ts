import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { roomsRouteState } from "./rooms.ts";
import { workHandleSchema } from "./command.ts";
export const roomsPlanImageSchema = z.object({
  href: z.string(),
  registration: z.object({
    imageSha256: z.string().optional(), width: z.number(), height: z.number(),
    topLeft: z.tuple([z.number(),z.number()]),
    topRight: z.tuple([z.number(),z.number()]),
    bottomLeft: z.tuple([z.number(),z.number()]),
  }),
});
export const roomsPlanRefusalSchema = z.enum(["NoCrop","NoImage","DegenerateCrop","AspectDisagrees","CropOutsideImage"]);
export const roomsPlanReadingSchema = z.union([
  z.object({plan:roomsPlanImageSchema}), z.object({refusal:roomsPlanRefusalSchema}),
]).nullable();
export type RoomsPlanReading = z.output<typeof roomsPlanReadingSchema>;
export const roomsArgs = z.object({ view: z.string() });
export const roomsData = z.object({
  roomsWork: roomsRouteState.schema,
  handle: workHandleSchema.nullable(),
  snapshot: nativeResponseSchema("rooms.snapshot"),
  trace: nativeResponseSchema("rooms.trace").nullable(),
  traceError: z.string().nullable(),
  plan: roomsPlanReadingSchema,
  planError: z.string().nullable(),
});

