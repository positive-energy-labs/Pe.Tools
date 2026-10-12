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

export const peaSessionDescriptorSchema = z.union([localWorldSchema, mesaWorldSchema]);
export type PeaSessionDescriptor = z.infer<typeof peaSessionDescriptorSchema>;
