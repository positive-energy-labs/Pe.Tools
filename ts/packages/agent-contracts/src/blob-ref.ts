import { z } from "zod";
/** Host-owned immutable bytes. The digest is the locator and the integrity witness. */
export const blobRefSchema = z.strictObject({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  fileName: z.string(),
});
export type BlobRef = z.infer<typeof blobRefSchema>;
