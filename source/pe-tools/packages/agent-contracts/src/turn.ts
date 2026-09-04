import { z } from "zod";
import { addressSchema } from "./reading.ts";

export const turnScopeContextKey = "pea.turnScope";
export const turnScopeSchema = z
  .object({
    id: z.uuid(),
    document: addressSchema.nullable(),
    target: z.string().trim().min(1).nullable(),
  })
  .strict();
