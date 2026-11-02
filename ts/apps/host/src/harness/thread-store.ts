import { Effect, Schema, SchemaGetter } from "effect";
import type { Types } from "effect";
import {
  allowDecisionSchema,
  emptyThreadHead,
  emptyThreadLifecycle,
  harnessEventSchema,
  harnessIds,
  harnessModelSchema,
  harnessThreadSummarySchema,
  promptCapabilitiesSchema,
  runRefSchema,
  threadHeadSchema,
  threadLifecycleSchema,
  traitOptionSchema,
  type HarnessEvent,
} from "@pe/agent-contracts";
import { fromStandardSchema } from "@pe/host-contracts/contracts";

/**
 * The thread store on disk (ADR 0029 rule 7): `<root>/<id>/meta.json` and `events.jsonl`, decoded,
 * never cast. Event lines are the `HarnessEvent` contract (zod, the wire the web reads) under an
 * Effect decode; `meta.json` is the record `writeMeta` writes, defaults filling what older builds
 * did not write.
 */
export const HarnessEventLine = Schema.fromJsonString(
  fromStandardSchema(harnessEventSchema, "HarnessEvent"),
);

const summary = harnessThreadSummarySchema.shape;
const contract = <T>(schema: Parameters<typeof fromStandardSchema<T>>[0], id: string) =>
  fromStandardSchema(schema, id);

const fields = {
  origin: Schema.optionalKey(contract(summary.origin.unwrap(), "ThreadOrigin")),
  id: Schema.String,
  harness: Schema.Literals(harnessIds),
  title: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  modelId: Schema.NullOr(Schema.String),
  /** A head that no longer parses reads as empty; it is re-derivable from the thread events. */
  head: contract(threadHeadSchema.catch(emptyThreadHead), "ThreadHead").pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(emptyThreadHead)),
  ),
  lifecycle: contract(threadLifecycleSchema, "ThreadLifecycle").pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(emptyThreadLifecycle)),
  ),
  tabs: contract(summary.tabs, "ThreadTabs").pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  /** Opaque here: `readWorkContext` decodes it and tolerates a stale shape. */
  workContext: Schema.optionalKey(Schema.Unknown),
  consentRoot: Schema.optionalKey(contract(runRefSchema, "RunRef")),
  runConsent: Schema.optionalKey(Schema.NullOr(contract(allowDecisionSchema, "AllowDecision"))),
  acpSessionId: Schema.NullOr(Schema.String),
  models: contract(harnessModelSchema.array(), "HarnessModels"),
  traits: contract(traitOptionSchema.array(), "TraitOptions").pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  traitValues: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  forkOf: Schema.NullOr(
    Schema.Struct({ threadId: Schema.String, acpSessionId: Schema.NullOr(Schema.String) }),
  ).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  promptCapabilities: Schema.NullOr(contract(promptCapabilitiesSchema, "PromptCapabilities")).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
};

/** What `meta.json` holds; the provider identity is absent on threads from before providers. */
export const ThreadMetaFile = Schema.Struct({
  ...fields,
  providerId: Schema.optionalKey(Schema.String),
  providerName: Schema.optionalKey(Schema.String),
});

/** A thread record in memory: the file with its provider identity filled, so both are required. */
const ThreadRecord = Schema.toType(
  Schema.Struct({ ...fields, providerId: Schema.String, providerName: Schema.String }),
);
export type Meta = Types.Mutable<typeof ThreadRecord.Type>;

/** `meta.json` text to a record; `providerName` names a pre-provider thread's harness. */
export const decodeThreadMeta = Effect.fn("thread.meta")(function* (
  text: string,
  providerName: (harness: Meta["harness"]) => string,
) {
  const record = ThreadMetaFile.pipe(
    Schema.decodeTo(ThreadRecord, {
      decode: SchemaGetter.transform((file) => ({
        ...file,
        providerId: file.providerId ?? file.harness,
        providerName: file.providerName ?? providerName(file.harness),
      })),
      encode: SchemaGetter.transform((meta) => meta),
    }),
  );
  const meta: Meta = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(record))(text);
  return meta;
});

/**
 * `events.jsonl` text to events. A line that does not decode is skipped and logged with its file
 * and line, never fatal: one torn or stale line must not cost the rest of the thread's memory.
 */
export const replayThreadEvents = Effect.fn("thread.replay")(function* (
  path: string,
  text: string,
) {
  const events: HarnessEvent[] = [];
  const skipped: number[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    const decoded = yield* Effect.result(Schema.decodeUnknownEffect(HarnessEventLine)(line));
    if (decoded._tag === "Success") events.push(decoded.success);
    else {
      skipped.push(index + 1);
      yield* Effect.logWarning("thread event skipped: it does not decode").pipe(
        Effect.annotateLogs({ path, line: index + 1, issue: String(decoded.failure) }),
      );
    }
  }
  return { events, skipped };
});
