import { z } from "zod";
export const familiesReadProgressSchema = z.object({
  runId: z.string(),
  state: z.enum(["reading", "complete", "cancelled", "failed"]),
  phase: z.string(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  workers: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type FamiliesReadProgress = z.infer<typeof familiesReadProgressSchema>;
