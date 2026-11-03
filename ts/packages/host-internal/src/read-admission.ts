import { Effect, Schema } from "effect";
import type { PreparedRead, ReadDescriptor } from "./request-contracts.d.ts";

/** Stable JSON: object key order is irrelevant, array order is part of identity. */
export function canonicalJson(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Schema.JsonObject)[key]!)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Only admission mints the frozen nominal type. Inputs cross their operation Schema first. */
export const prepareRead = Effect.fn("ReadAdmission.prepare")(function* <A>(
  descriptor: Omit<ReadDescriptor, "normalizedInput">,
  input: unknown,
  request: Schema.Codec<Schema.Json>,
  response: Schema.Codec<A, unknown>,
) {
  const decoded = yield* Schema.decodeUnknownEffect(request)(input);
  const encoded = yield* Schema.encodeEffect(request)(decoded);
  const normalizedInput = canonicalJson(yield* Schema.decodeUnknownEffect(Schema.Json)(encoded));
  // The private declaration brand has no public constructor. This is its sole mint.
  return Object.freeze({
    descriptor: Object.freeze({
      ...descriptor,
      normalizedInput,
      operation: Object.freeze({ ...descriptor.operation }),
      processIncarnation: Object.freeze({ ...descriptor.processIncarnation }),
      openDocumentLifetime: Object.freeze({ ...descriptor.openDocumentLifetime }),
    }),
    response,
  }) as unknown as PreparedRead<A>;
});

/** Minting requires a context-free Codec; the frozen public Schema view erases that fact. */
export const decodePreparedRead = <A>(read: PreparedRead<A>, value: unknown) =>
  Schema.decodeUnknownEffect(read.response as Schema.Codec<A, unknown>)(value);
