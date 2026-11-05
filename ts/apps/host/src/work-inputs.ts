/**
 * Work as a host input (ADR 0031): the exact RouteWorkspace read each body consumes, its recorded
 * identity, and its authoritative codec. The canonical RouteWorkspace reads live, captures what it
 * delivers, or replays through these adapters over the one taking store; never a second Work store.
 */
import { Effect, Schema } from "effect";
import { z } from "zod";
import {
  workHandleSchema,
  workKey,
  workWriteAckSchema,
  type ReadingRequest,
  type WorkHandle,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { canonicalJson } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import type {
  RouteWorkspace,
  WorkFeedShape,
  WorkReadCapture,
  WorkReadSource,
} from "@pe/runtime";
import {
  captureInput,
  inputBindingKey,
  replayInput,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "./native-recording.ts";

/** The exact feed admission, from the public Reading contract that carries it. */
type WorkAdmission = NonNullable<Extract<ReadingRequest, { kind: "work" }>["admission"]>;

export type WorkView = "read" | "raw" | "view" | "feed";
/** The Work member of RecordedInput: the canonical Work key and the read shape it names. */
export type WorkInput = { readonly kind: "work"; readonly key: string; readonly view: WorkView };
export const workInput = (key: WorkKey, view: WorkView): WorkInput => ({
  kind: "work",
  key: workKey(key),
  view,
});

type Reads = {
  read: Awaited<ReturnType<RouteWorkspace["read"]>>;
  raw: Awaited<ReturnType<RouteWorkspace["readRaw"]>>;
  view: Awaited<ReturnType<RouteWorkspace["view"]>>;
};
type ReadView = keyof Reads;
export type WorkValue<V extends ReadView> = Reads[V];

const revision = z.number().int().nonnegative();
const raw = z.object({ doc: z.unknown(), revision, handle: workHandleSchema })
  .refine((value) => value.revision === value.handle.revision);
// `view`/`read` also carry route, title, schema and schemaVersion; they pass through as recorded.
const shaped = raw.safeExtend({
  route: z.string(), title: z.string(), description: z.string(),
  schemaVersion: z.number().int().positive().nullable(), schema: z.record(z.string(), z.unknown()),
}).refine((value) => value.route === value.handle.key.route).passthrough();
const history = <T extends z.ZodType<{ revision: number; handle: WorkHandle }>>(base: T) =>
  z.intersection(base, z.object({ history: z.object({ from: revision, acks: z.array(workWriteAckSchema) }) }))
    .refine(({ handle, revision, history }) => history.acks.length
      ? history.acks.every((ack, index) => ack.revision === history.from + index &&
          workKey(ack.key) === workKey(handle.key)) &&
        history.acks.at(-1)!.revision === revision
      : history.from === revision + 1);
const contracts: { readonly [V in ReadView | WorkFeedShape]: z.ZodType } = {
  raw: raw.nullable(),
  read: shaped.nullable(),
  view: shaped.nullable(),
  // The two feed shapes are different values: `work` is the view with history, `work-acks` the snapshot.
  work: history(shaped),
  "work-acks": history(raw),
};
/** Recorded Work bytes must satisfy the existing Work handle and ack contracts; nothing is coerced. */
const codec = <A>(contract: keyof typeof contracts) =>
  Schema.Json.check(
    Schema.makeFilter(
      (value) => contracts[contract].safeParse(value).success || `Recorded Work ${contract} violates its contract`,
    ),
  ) as unknown as Schema.Codec<A, Schema.Json>;
export const workInputCodecs: { readonly [V in ReadView]: Schema.Codec<WorkValue<V>, Schema.Json> } =
  { read: codec("read"), raw: codec("raw"), view: codec("view") };
export const workFeedCodecs: { readonly [S in WorkFeedShape]: Schema.Codec<unknown, Schema.Json> } =
  { work: codec("work"), "work-acks": codec("work-acks") };

/** The fence a Work taking is kept under: its canonical key, plus the feed's exact admission and shape. */
export const workInputScope = (
  key: WorkKey,
  feed?: { readonly admission: WorkAdmission; readonly shape: WorkFeedShape },
) => canonicalJson(feed ? [workKey(key), feed.shape, feed.admission] : [workKey(key)]);

/** The composition's captured Effect edge; it rejects with the DoorFailure itself, class and status kept. */
export type WorkInputRunner = <A>(effect: Effect.Effect<A, DoorFailure>) => Promise<A>;

/**
 * Historical Work: each canonical read and admitted feed answered only by its recorded taking.
 * `bindings` names the exact taking per `inputBindingKey`; an unbound repeat stays ambiguous.
 */
export const recordedWorkSource = (
  reader: RecordingReader,
  run: WorkInputRunner,
  bindings: ReadonlyMap<string, string> = new Map(),
): WorkReadSource => {
  const replay = <A>(input: WorkInput, scope: string, codec: Schema.Codec<A, Schema.Json>) =>
    run(replayInput(reader, input, scope, codec, bindings.get(inputBindingKey(input, scope))));
  return {
    read: (key, view) => replay(workInput(key, view), workInputScope(key), workInputCodecs[view]),
    feed: (key, admission, shape) =>
      replay(workInput(key, "feed"), workInputScope(key, { admission, shape }), workFeedCodecs[shape]),
  };
};

/**
 * Live capture of the value a Work read is about to deliver, through the one taking store. Capture
 * is ancillary (K4): a value that cannot be serialized or fails its codec, like a full store, I/O or
 * observer failure, stops the writer's capture as truncated and never fails the live Work.
 */
export const capturedWorkReads = (
  writer: RecordingWriter,
  run: WorkInputRunner,
  observed?: TakingObserver,
): WorkReadCapture => {
  const keep = (input: WorkInput, scope: string, codec: Schema.Codec<unknown, Schema.Json>, value: unknown) =>
    run(
      Effect.gen(function* () {
        // The recorded observation is the delivered value's JSON; an undefined root is not a null.
        const serialized = yield* Effect.try(() => {
          if (value === undefined) throw Error("no value");
          return JSON.parse(JSON.stringify(value)) as unknown;
        });
        const decoded = yield* Schema.decodeUnknownEffect(codec)(serialized);
        yield* captureInput(writer, input, scope, codec, Effect.succeed(decoded), observed);
      }).pipe(
        Effect.catchTag(["UnknownError", "SchemaError"], () => {
          const at = writer.capture.begin();
          return at === null ? Effect.void : writer.capture.stop(at, "encoding");
        }),
      ),
    );
  return {
    read: (key, view, value) =>
      keep(workInput(key, view), workInputScope(key), workInputCodecs[view] as Schema.Codec<unknown, Schema.Json>, value),
    feed: (key, admission, shape, value) =>
      keep(workInput(key, "feed"), workInputScope(key, { admission, shape }), workFeedCodecs[shape], value),
  };
};
