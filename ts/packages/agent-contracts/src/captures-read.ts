import { z } from "zod";
import { captureReceiptSchema } from "./capture.ts";
export const capturesArgs = z.object({});
export const capturesValue = z.object({ captures: z.array(captureReceiptSchema) });
