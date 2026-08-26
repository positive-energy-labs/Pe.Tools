import { z } from "zod";

export const readingFromSchema = z.object({
  target: z.string(),
  documentId: z.string().optional(),
  documentVersionToken: z.string().optional(),
  observedAt: z.iso.datetime(),
});

export type ReadingFrom = z.infer<typeof readingFromSchema>;
