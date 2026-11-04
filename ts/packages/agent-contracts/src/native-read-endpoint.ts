import { Schema } from "effect";
import type { ResolvedReadDescriptor } from "./native-read-door.ts";

/** Target selection uses the same HostSessionScope headers as /call. No native work starts here. */
export const nativeReadResolveEndpoint = {
  method: "POST",
  path: "/pe/reads/resolve",
  lifetime: "read",
  body: Schema.Struct({ operationKey: Schema.String, input: Schema.Json }),
} as const;

/** Runtime decoder for the existing descriptor contract; never a second identity model. */
export const resolvedReadDescriptorSchema = Schema.Struct({
  operationKey: Schema.String,
  processIncarnation: Schema.Struct({ pid: Schema.Number, startedAt: Schema.Number }),
  openDocumentLifetime: Schema.Union([
    Schema.Struct({ openId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("session-only") }),
  ]),
  normalizedInput: Schema.String,
  freshnessGeneration: Schema.NullOr(Schema.String),
  freshnessEvidence: Schema.optionalKey(Schema.Literal("unavailable")),
  representation: Schema.Literals(["overview", "detail"]),
}) satisfies Schema.Codec<ResolvedReadDescriptor>;
