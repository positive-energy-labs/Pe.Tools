import { z } from "zod";

export const opsReceiptSchema = z.object({
  opKey: z.string(),
  request: z.unknown().optional(),
  value: z.unknown(),
  elapsedMs: z.number().nonnegative(),
  target: z.string(),
  observedAt: z.iso.datetime(),
});
export type OpsReceipt = z.infer<typeof opsReceiptSchema>;
