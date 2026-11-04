import { Schema } from "effect";

/**
 * Harness edges the host does not author (ADR 0029 rule 7), decoded, never cast: the Codex config a
 * provider env carries, an endpoint's probe replies, and the CLI discovery reads of `adapter.ts`.
 */

/** `CODEX_CONFIG` as the provider env carries it (`providers.ts` writes an object); keys verbatim. */
export const CodexConfig = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

/** `GET /models` on either API: only rows with a string id are models. */
export const ModelList = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

const Part = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.Unknown) });
/** The Messages API reply: assistant text is a `text` content part. */
export const MessagesReply = Schema.Struct({ content: Schema.optionalKey(Schema.Array(Part)) });
/** The Responses API reply: assistant text is an `output_text` part of a `message` output. */
export const ResponsesReply = Schema.Struct({
  output: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ type: Schema.String, content: Schema.optionalKey(Schema.Array(Part)) }),
    ),
  ),
});

/** An adapter package's `package.json`: the first `bin` entry is the CLI the host runs. */
export const AdapterPackage = Schema.fromJsonString(
  Schema.Struct({ bin: Schema.Record(Schema.String, Schema.String) }),
);

/** The Win32 access check's rows (`ConvertTo-Json -Compress`): one object, or an array of them. */
const Win32Row = Schema.Struct({
  code: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export const Win32Rows = Schema.fromJsonString(Schema.Union([Win32Row, Schema.Array(Win32Row)]));
