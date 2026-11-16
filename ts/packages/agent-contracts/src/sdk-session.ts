import { z } from "zod";

/** SDK builder options: a name is always a name, including bare digits. Omit for the SDK ladder. */
export const sdkSessionSelectionSchema = z.union([
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({ pid: z.number().int().positive() }),
]);
export type SdkSessionSelection = z.infer<typeof sdkSessionSelectionSchema>;

/** An admitted SDK session is an exact process, not a reusable SDK selection label. */
export const sdkSessionReferenceSchema = z.strictObject({
  session: z.string().min(1),
  processIncarnation: z.strictObject({
    pid: z.number().int().positive(),
    startedAt: z.number().int().positive(),
  }),
});
export type SdkSessionReference = z.infer<typeof sdkSessionReferenceSchema>;
export const sdkSessionTargetSchema = z.union([
  sdkSessionSelectionSchema,
  sdkSessionReferenceSchema,
]);

/** SDK document ids and product DocumentRef.openId belong to different registries. */
export const sdkDocumentRefSchema = z.strictObject({
  source: z.literal("sdk"),
  session: sdkSessionSelectionSchema,
  openId: z.string().min(1),
});
export type SdkDocumentRef = z.infer<typeof sdkDocumentRefSchema>;
