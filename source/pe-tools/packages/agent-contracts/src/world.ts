import { z } from "zod";

const localWorldSchema = z.strictObject({
  id: z.string().min(1),
  root: z.string().min(1),
  storage: z.strictObject({ kind: z.literal("local-unversioned") }),
  isolation: z.literal("none"),
});

const mesaWorldSchema = z.strictObject({
  id: z.string().min(1),
  root: z.string().min(1),
  storage: z.strictObject({
    kind: z.literal("mesa-versioned"),
    org: z.string().min(1),
    repo: z.string().min(1),
    bookmark: z.string().min(1),
    changeId: z.string().min(1),
    commitOid: z.string().min(1),
  }),
  isolation: z.literal("bwrap"),
});

export const peaWorldDescriptorSchema = z.union([localWorldSchema, mesaWorldSchema]);
export type PeaWorldDescriptor = z.infer<typeof peaWorldDescriptorSchema>;

export const peInfoSchema = z.strictObject({
  controllerId: z.string().min(1),
  resourceId: z.string().min(1),
  world: peaWorldDescriptorSchema,
});
export type PeInfo = z.infer<typeof peInfoSchema>;
