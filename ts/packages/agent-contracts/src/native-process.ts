import { z } from "zod";

export const nativeProcessSchema = z.strictObject({
  pid: z.number().int().positive(),
  processStartUtc: z.string().min(1),
  executable: z.string().min(1),
});
export type NativeProcess = z.infer<typeof nativeProcessSchema>;
