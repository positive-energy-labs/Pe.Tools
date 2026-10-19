import { z } from "zod";

/** Explicit promotion: HTML Pages are never executable shell routes. */
export const podRouteDeclarationSchema = z.strictObject({
  sourcePath: z.string().regex(/^routes\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.js$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  page: z
    .string()
    .regex(/^pages\/[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});
export type PodRouteDeclaration = z.infer<typeof podRouteDeclarationSchema>;
export const podRouteDescriptorSchema = podRouteDeclarationSchema.extend({
  key: z.string().min(1),
  packageId: z.string().min(1),
  workRoute: z.string().min(1).max(100),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  trusted: z.boolean(),
});
export type PodRouteDescriptor = z.infer<typeof podRouteDescriptorSchema>;
