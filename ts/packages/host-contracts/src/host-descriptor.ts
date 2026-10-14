import { z } from "zod";
import { NATIVE_ADAPTER_VERSION } from "./native-adapter.ts";

export const hostDescriptorSchema = z.strictObject({
  version: z.string().min(1),
  /** Advertised protocol revisions. Native presence belongs to the local window. */
  features: z.strictObject({
    peApi: z.literal(1),
    nativeAdapter: z.literal(NATIVE_ADAPTER_VERSION),
  }),
});
export type HostDescriptor = z.infer<typeof hostDescriptorSchema>;
export const hostDescriptor = (version: string): HostDescriptor =>
  hostDescriptorSchema.parse({
    version,
    features: { peApi: 1, nativeAdapter: NATIVE_ADAPTER_VERSION },
  });
