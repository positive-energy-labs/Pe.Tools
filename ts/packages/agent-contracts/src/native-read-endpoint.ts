import { Schema } from "effect";

/** Target selection uses the same HostSessionScope headers as /call. No native work starts here. */
export const nativeReadResolveEndpoint = {
  method: "POST",
  path: "/pe/reads/resolve",
  lifetime: "read",
  body: Schema.Struct({ operationKey: Schema.String, input: Schema.Json }),
} as const;
