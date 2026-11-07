import { z } from "zod";
import { sdkSessionSelectionSchema } from "./sdk-session.ts";

export const holdingsReadingSchema = z.strictObject({
  kind: z.literal("sdk"),
  read: z.literal("holdings"),
  section: z.enum(["elements", "worksets"]).default("elements"),
  session: sdkSessionSelectionSchema,
  processStartUtc: z.iso.datetime(),
  openId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional(),
});
export type HoldingsReading = z.infer<typeof holdingsReadingSchema>;
