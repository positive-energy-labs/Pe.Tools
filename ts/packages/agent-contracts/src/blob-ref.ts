import { z } from "zod";
/** Host-owned immutable bytes. The digest is the locator and the integrity witness. */
export const blobRefSchema = z.strictObject({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  fileName: z.string(),
});
export type BlobRef = z.infer<typeof blobRefSchema>;

export const blobUploadSchema = z.strictObject({
  fileName: z.string().min(1),
  base64: z.string().min(1).refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "Expected base64 bytes"),
});
export type BlobUpload = z.infer<typeof blobUploadSchema>;
