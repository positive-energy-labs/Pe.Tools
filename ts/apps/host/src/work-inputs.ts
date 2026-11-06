/**
 * Work as a host input (ADR 0031): the exact RouteWorkspace read each body consumes, its recorded
 * identity, and its authoritative codec. The canonical RouteWorkspace reads live, captures what it
 * delivers, or replays through these adapters over the one taking store; never a second Work store.
 */
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import {
  workHandleSchema,
  workKey,
  workWriteAckSchema,
  type ReadingRequest,
  type WorkHandle,
  type WorkKey,
} from "@pe/agent-contracts";
import { canonicalJson } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import {
  WorkCarriage,
  type RouteWorkspace,
  type WorkFeedShape,
  type WorkReadBegin,
  type WorkReadCapture,
  type WorkReadContext,
  type WorkReadRequest,
  type WorkReadSource,
} from "@pe/runtime";
import {
  CurrentInputAttempt,
  CurrentInputConsumption,
  type InputConsumption,
} from "./input-occurrence.ts";
import { InvalidRead } from "./native-reads.ts";
import {
  captureInput,
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
  work: history(shaped).nullable(),
  "work-acks": history(raw).nullable(),
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

/** One begun Work read: its runner provides the request's consumption and this reserved attempt. */
class WorkAttempt extends WorkCarriage {
  constructor(readonly run: WorkInputRunner) {
    super();
  }
}
/** The only carriage these hooks accept: the host's own attempt, checked by class, never cast. */
const attemptOf = (carriage: WorkCarriage | undefined) =>
  carriage instanceof WorkAttempt ? carriage : undefined;
const occurrenceOf = (request: WorkReadRequest) =>
  request.kind === "read"
    ? { input: workInput(request.key, request.view), scope: workInputScope(request.key) }
    : { input: workInput(request.key, "feed"), scope: workInputScope(request.key, request) };

/**
 * A request's Work carriage over its own consumption. `begin` reserves the occurrence
 * synchronously at read start; the attempt's runner is the request's captured `run` with that same
 * consumption and the reserved attempt provided, so the Work queue cannot cross-bind requests.
 */
export const workReadContext = (consumption: InputConsumption, run: WorkInputRunner): WorkReadContext => ({
  begin: (request) => {
    const { input, scope } = occurrenceOf(request);
    const started = consumption.start(input, scope);
    if (Result.isFailure(started)) return { ok: false, error: started.failure };
    const attempt = started.success;
    return {
      ok: true,
      carriage: new WorkAttempt((effect) =>
        run(
          effect.pipe(
            Effect.provideService(CurrentInputAttempt, attempt),
            Effect.provideService(CurrentInputConsumption, consumption),
          ),
        ),
      ),
    };
  },
});

const noContext = () =>
  new InvalidRead({
    message: "Historical Work needs its consumer's read context",
    status: 409,
    problem: "recording.context",
  });

/**
 * Historical Work: each canonical read and admitted feed answered only by the taking its own
 * consumer's attempt selects. Without that context it refuses before any access; no root fallback.
 */
export const recordedWorkSource = (reader: RecordingReader): WorkReadSource => {
  const replay = <A>(carriage: WorkCarriage | undefined, request: WorkReadRequest, codec: Schema.Codec<A, Schema.Json>) => {
    const attempt = attemptOf(carriage);
    if (!attempt) return Promise.reject(noContext());
    const { input, scope } = occurrenceOf(request);
    return attempt.run(replayInput(reader, input, scope, codec));
  };
  return {
    begin: (request, context) => (context ? context.begin(request) : { ok: false, error: noContext() }),
    read: (key, view, carriage) => replay(carriage, { kind: "read", key, view }, workInputCodecs[view]),
    feed: (key, admission, shape, carriage) =>
      replay(carriage, { kind: "feed", key, admission, shape }, workFeedCodecs[shape]),
  };
};

/**
 * Live capture of the value a Work read is about to deliver, through the one taking store. Capture
 * is ancillary (K4): a missing context, a value that cannot be serialized or fails its codec, like a
 * full store, I/O or observer failure, stops the writer's capture as truncated and never fails the
 * live Work. Each hook runs on its own attempt's runner; `latchRun` only persists a latch stop.
 */
export const capturedWorkReads = (
  writer: RecordingWriter,
  latchRun: WorkInputRunner,
  observed?: TakingObserver,
): WorkReadCapture => {
  // The latch is set synchronously; this adapter owns the best-effort marker writes.
  let persisting: Promise<void> = Promise.resolve();
  const stopNow = (reason: "backlog" | "unsupported") => {
    const at = writer.capture.begin();
    if (at === null) return persisting;
    const persisted = latchRun(writer.capture.stop(at, reason)).catch(() => undefined);
    return (persisting = persisting.then(() => persisted));
  };
  const uncaptured: WorkReadBegin = { ok: true, carriage: undefined };
  const keep = (carriage: WorkCarriage | undefined, request: WorkReadRequest, codec: Schema.Codec<unknown, Schema.Json>, value: unknown) => {
    const attempt = attemptOf(carriage);
    if (!attempt) return Promise.resolve(); // never begun: capture already stopped
    const { input, scope } = occurrenceOf(request);
    return attempt.run(
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
  };
  // A failed live read, kept through the one store: a supported DoorFailure as its class-faithful
  // taking, anything else stops capture as `unsupported`. Its exit is the failure itself, which the
  // workspace already rethrows as the original; only the taking matters here.
  const lose = (carriage: WorkCarriage | undefined, request: WorkReadRequest, codec: Schema.Codec<unknown, Schema.Json>, error: unknown) => {
    const attempt = attemptOf(carriage);
    if (!attempt) return Promise.resolve();
    const { input, scope } = occurrenceOf(request);
    return attempt.run(
      Effect.asVoid(Effect.exit(captureInput(writer, input, scope, codec, Effect.fail(error as DoorFailure), observed))),
    );
  };
  const readCodec = (view: keyof typeof workInputCodecs) =>
    workInputCodecs[view] as Schema.Codec<unknown, Schema.Json>;
  return {
    // No context, or a start that cannot be reserved: stop capture now (K4); the read stays live.
    begin: (request, context) => {
      const begun = context?.begin(request);
      if (begun?.ok) return begun;
      void stopNow("unsupported");
      return uncaptured;
    },
    read: (key, view, value, carriage) => keep(carriage, { kind: "read", key, view }, readCodec(view), value),
    feed: (key, admission, shape, value, carriage) =>
      keep(carriage, { kind: "feed", key, admission, shape }, workFeedCodecs[shape], value),
    readFailed: (key, view, error, carriage) => lose(carriage, { kind: "read", key, view }, readCodec(view), error),
    feedFailed: (key, admission, shape, error, carriage) =>
      lose(carriage, { kind: "feed", key, admission, shape }, workFeedCodecs[shape], error),
    stop: (reason) => stopNow(reason),
  };
};
