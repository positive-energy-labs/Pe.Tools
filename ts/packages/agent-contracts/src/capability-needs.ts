import { z } from "zod";

export const capabilityNeedsSchema = z.enum([
  "nothing",
  "document",
  "project-document",
  "family-document",
  "session",
]);
export type CapabilityNeeds = z.infer<typeof capabilityNeedsSchema>;
