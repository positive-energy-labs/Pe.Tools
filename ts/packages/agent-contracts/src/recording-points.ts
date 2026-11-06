import { Schema } from "effect";
import { identityCodecs } from "./route-kernel-codecs.ts";
import type { IdentityId } from "./route-kernel-page.ts";

declare const pointId: unique symbol;
/** Opaque host-minted name; decoding a name does not grant access to a point. */
export type RecordingPointId = string & { readonly [pointId]: "RecordingPointId" };
export const recordingPointIdSchema = Schema.declare(
  (value): value is RecordingPointId =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
);
const document = Schema.declare(
  (value): value is IdentityId<"document"> =>
    typeof value === "string" && identityCodecs.document.decode(value).ok,
);
const cursor = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0));
export const recordingPointReasonSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("afterWrite"), receipt: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("synced") }),
  Schema.Struct({ kind: Schema.Literal("captured") }),
]);
export type RecordingPointReason = typeof recordingPointReasonSchema.Type;
export const recordingPointBindingSchema = Schema.Struct({
  instance: Schema.NonEmptyString,
  reading: Schema.NonEmptyString,
  argsHash: Schema.NonEmptyString,
  readSetId: Schema.NonEmptyString,
});
export type RecordingPointBinding = typeof recordingPointBindingSchema.Type;
export type RecordingConsumer = Omit<RecordingPointBinding, "readSetId">;
/** Metadata only. The range is half-open in durable taking append order, never clock order. */
export const recordingPointSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: recordingPointIdSchema,
  document,
  reason: recordingPointReasonSchema,
  at: Schema.Number.check(Schema.makeFilter(Number.isFinite)),
  identity: Schema.Struct({ build: Schema.String, catalog: Schema.String }),
  takingRange: Schema.Struct({ start: cursor, end: cursor }),
  bindings: Schema.Array(recordingPointBindingSchema),
});
export type RecordingPoint = typeof recordingPointSchema.Type;
export type RecordingBasis =
  | { readonly kind: "live" }
  | { readonly kind: "point"; readonly point: RecordingPointId }
  | { readonly kind: "compare"; readonly point: RecordingPointId };
