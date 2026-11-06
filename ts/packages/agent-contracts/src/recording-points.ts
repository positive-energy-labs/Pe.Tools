import { Schema } from "effect";
import { identityCodecs } from "./route-kernel-codecs.ts";
import type { IdentityId } from "./route-kernel-page.ts";

declare const pointId: unique symbol;
/** Opaque host-minted name; decoding a name does not grant access to a point. */
export type RecordingPointId = string & { readonly [pointId]: "RecordingPointId" };
export const recordingPointIdSchema = Schema.declare(
  (value): value is RecordingPointId =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
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
export const BODY_RECEIPT_HEADER = "x-pe-body-receipt";
export const recordingConsumerSchema = Schema.Struct({
  instance: Schema.NonEmptyString,
  reading: Schema.NonEmptyString,
  argsHash: Schema.NonEmptyString,
});
const batch = <A extends Schema.Top>(schema: A) =>
  Schema.Array(schema).check(Schema.makeFilter((values) => values.length <= 32));
export const acceptedReadingSchema = Schema.Struct({
  document,
  consumer: recordingConsumerSchema,
  bodyReceipts: batch(Schema.NonEmptyString).check(
    Schema.makeFilter((values) => values.length > 0),
  ),
});
export type AcceptedReading = typeof acceptedReadingSchema.Type;
export const recordingAcknowledgementsSchema = Schema.Struct({
  accepted: Schema.optionalKey(batch(acceptedReadingSchema)),
  unmounted: Schema.optionalKey(batch(recordingConsumerSchema)),
});
export interface RecordingAcknowledgements {
  readonly accepted: readonly AcceptedReading[];
  readonly unmounted: readonly RecordingConsumer[];
}
/** Canonical boundary adapter for the Effect-free resource transport. */
export function decodeRecordingAcknowledgements(
  value: unknown,
): RecordingAcknowledgements | { error: string } {
  try {
    const decoded = Schema.decodeUnknownSync(recordingAcknowledgementsSchema)(value);
    return { accepted: decoded.accepted ?? [], unmounted: decoded.unmounted ?? [] };
  } catch {
    return { error: "Invalid accepted reading acknowledgements" };
  }
}
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
