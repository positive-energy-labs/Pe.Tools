import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import { validationIssueSchema } from "@pe/host-contracts/contracts";
import { refusalSchema, type InputKind, type InputLane, type Truncation, type RecordingPoint } from "@pe/agent-contracts";
import { canonicalJson, type NativeReadInput } from "./native-read.ts";
import { BridgeError } from "./dispatch.ts";
import { InvalidRead, ReadBusy, ReadRetiring } from "./read-errors.ts";
import type { DoorFailure } from "./request-contracts.d.ts";
import { Refused } from "./refused.ts";
import { attemptFor, inputIdentity, inputBindingKey } from "./input-occurrence.ts";

export { inputBindingKey };

export interface RecordingIdentity {
  readonly build: string;
  readonly catalog: string;
}
const nativeOutcome = Schema.Literals([
  "never-dispatched",
  "native-cancel-requested",
  "native-acknowledged",
  "committed",
  "unknown-until-reconciled",
]);
const actualTarget = Schema.Struct({
  processIncarnation: Schema.Struct({ pid: Schema.Number, startedAt: Schema.Number }),
  openDocumentLifetime: Schema.Union([
    Schema.Struct({ openId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("session-only") }),
  ]),
});
/**
 * A recorded failure is one of the classes replay can rebuild exactly, by that class's own
 * constructor. Any other failure is refused at capture, before a taking exists.
 */
const plainFailure = { message: Schema.String, status: Schema.Number, problem: Schema.String };
const recordedEvidence = Schema.StructWithRest(
  Schema.Struct({
    nativeRequestId: Schema.optionalKey(Schema.String),
    receiptId: Schema.optionalKey(Schema.String),
    actualTarget: Schema.optionalKey(actualTarget),
    notDispatched: Schema.optionalKey(Schema.Literal(true)),
    dispatched: Schema.optionalKey(Schema.Literal(true)),
    nativeOutcome: Schema.optionalKey(Schema.String),
    issues: Schema.optionalKey(Schema.NullOr(Schema.Array(validationIssueSchema))),
    result: Schema.optionalKey(Schema.Json),
    resolvedTarget: Schema.optionalKey(
      Schema.Struct({ session: Schema.String, document: Schema.NullOr(Schema.String) }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const failure = Schema.Union([
  Schema.Struct({
    tag: Schema.Literals(["InvalidRequest", "ReadBusy", "ReadRetiring"]),
    ...plainFailure,
  }),
  Schema.Struct({ tag: Schema.Literal("Refused"), refusal: Schema.Json }),
  Schema.Struct({
    tag: Schema.Literal("BridgeError"),
    ...plainFailure,
    nativeOutcome: Schema.optionalKey(nativeOutcome),
    // The whole serializable dispatch evidence: BridgeError.outcome reads notDispatched/dispatched/issues.
    evidence: recordedEvidence,
  }),
]);
// Decoded before any path is built: a taking cannot name a file outside its observations.
export const sha256Name = Schema.String.check(
  Schema.makeFilter((name) => /^[0-9a-f]{64}$/.test(name) || "Observation name is not a SHA-256"),
);
// Format 3: the marks input carries its frame. Older formats are refused, never migrated.
export const FORMAT = 3;
/** What one taking recorded: a native read, or one input owner's exact read shape. */
const recordedInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("resource"), key: Schema.String, args: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("publication"), key: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("native"), key: Schema.String, args: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("document"), scope: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("files"),
    file: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("marks"),
    ref: Schema.Struct({ session: Schema.String, openId: Schema.String }),
    /** Null for a bare snapshot; the consuming frame's own key for a frame read, so they never alias. */
    frame: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("work"),
    key: Schema.String,
    view: Schema.Literals(["read", "raw", "view", "feed"]),
  }),
]);
export type RecordedInput = typeof recordedInput.Type;
export const takingSchema = Schema.Struct({
  version: Schema.Literal(FORMAT),
  id: Schema.String,
  at: Schema.Number,
  input: recordedInput,
  /** Canonical JSON of the read's explicit scope; replay serves only that scope. */
  scope: Schema.String,
  outputVersion: Schema.String,
  outcome: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("answered"),
      observation: sha256Name,
      nativeRequestId: Schema.String,
      actualTarget,
      freshness: Schema.Struct({ freshnessGeneration: Schema.String }),
      cost: Schema.Struct({
        elements: Schema.optionalKey(Schema.Number),
        triangles: Schema.optionalKey(Schema.Number),
        bytes: Schema.optionalKey(Schema.Number),
        elapsed: Schema.optionalKey(Schema.Number),
      }),
      nativeOutcome,
    }),
    /** A non-native owner's value, encoded by that owner's codec. */
    Schema.Struct({ kind: Schema.Literal("observed"), observation: sha256Name }),
    Schema.Struct({ kind: Schema.Literal("refused"), failure }),
    Schema.Struct({ kind: Schema.Literal("unknown"), failure }),
  ]),
});
export type Taking = typeof takingSchema.Type;
export type TakingInput = Pick<Taking, "input" | "scope" | "outputVersion">;
export type Answered = Extract<Taking["outcome"], { kind: "answered" }>;
export type Outcome =
  | {
      readonly kind: "answered";
      readonly value: Schema.Json;
      readonly answer: Omit<Answered, "kind" | "observation">;
    }
  | { readonly kind: "observed"; readonly value: Schema.Json }
  | Exclude<Taking["outcome"], { kind: "answered" | "observed" }>;

/** Non-native codecs belong to the build, and the manifest already fixes the build. */
const BUILD_VERSION = "build";

export const refuse = (problem: string, message: string, status = 409) =>
  new InvalidRead({ message, status, problem: `recording.${problem}` });

/** A host-owned provenance port, told the exact durable taking a capture appended before the read answers. */
export type TakingObserver = (taking: Taking) => Effect.Effect<void, DoorFailure>;
export const unobserved: TakingObserver = () => Effect.void;

/** A consumer's fixed host recipe: its build-bound key, actual validated input and exact scope. */
const consumerRecipe = Schema.Struct({ key: Schema.String, input: Schema.Json, scope: Schema.String });
// Host-minted ids only; decoded before any path is built.
export const readSetIdName = Schema.String.check(
  Schema.makeFilter((id) => /^[0-9a-f-]{36}$/.test(id) || "Read-set id is not host minted"),
);
/**
 * Which exact takings one consumer read, in the same bundle (version 2, beside format-3 takings).
 * Metadata and links only: source data stays in the owners' observations.
 */
export const readSetRecordSchema = Schema.Struct({
  version: Schema.Literal(2),
  id: readSetIdName,
  identity: Schema.Struct({ build: Schema.String, catalog: Schema.String }),
  recipe: consumerRecipe,
  state: Schema.Literals(["complete", "incomplete"]),
  inputs: Schema.Array(
    Schema.Struct({ input: recordedInput, scope: Schema.String, start: Schema.Number, takingId: Schema.String }),
  ),
  children: Schema.Array(
    Schema.Struct({ recipe: consumerRecipe, start: Schema.Number, readSetId: readSetIdName }),
  ),
  takingLinks: Schema.Record(Schema.String, Schema.String),
  dependencies: Schema.Record(Schema.String, readSetIdName),
  exports: Schema.Array(Schema.Struct({ kind: Schema.String, basis: Schema.String })),
});
export type InputReadSetRecord = typeof readSetRecordSchema.Type;
export type ConsumerRecipe = typeof consumerRecipe.Type;
/** A historical bundle, read only: replay can select and read takings but never add one. */
export interface RecordingReader {
  readonly identity: RecordingIdentity;
  /** Half-open append cursors; timestamps and candidate order never select a point. */
  readonly takingCursor: () => number;
  readonly takingAt: (cursor: number) => Taking | undefined;
  readonly points: {
    readonly ids: () => readonly string[];
    readonly get: (id: string) => Effect.Effect<RecordingPoint, InvalidRead>;
  };
  /** Every taking of one input identity, oldest first; equal bytes never merge takings. */
  readonly candidates: (identity: string) => readonly Taking[];
  readonly taking: (id: string) => Taking | undefined;
  readonly observation: (taking: Taking) => Effect.Effect<Schema.Json, InvalidRead>;
  /** The kinds with at least one durable taking: coarse, never proof that a read set is served. */
  readonly coverage: () => readonly InputKind[];
  /** Where automatic capture stopped, when its marker was kept; such a bundle is not complete. */
  readonly truncation: Truncation | null;
  /** Sealed consumption metadata, by host-minted id; every input and link names a real taking. */
  readonly readSets: {
    readonly get: (id: string) => Effect.Effect<InputReadSetRecord, InvalidRead>;
    /** Loaded (or durably kept) host-minted names; no order or recency meaning. */
    readonly ids: () => readonly string[];
  };
}
/**
 * One writer's automatic-capture latch. Capture is ancillary to live input: the first capture that
 * cannot be kept stops every wrapper sharing this writer, and the live read still answers.
 */
export interface CaptureLatch {
  /** The next attempt's ordinal, or null once capture has stopped. */
  readonly begin: () => number | null;
  readonly truncated: () => Truncation | null;
  /** The first stop wins; its marker is persisted best-effort and never fails a read. */
  readonly stop: (at: number, reason: Truncation["reason"], source: Pick<Truncation, "site" | "op">) => Effect.Effect<void>;
}
/** The one capture writer of a bundle in this process (no cross-process lock is claimed). */
export interface RecordingWriter extends RecordingReader {
  readonly points: RecordingReader["points"] & {
    readonly keep: (point: RecordingPoint) => Effect.Effect<void, InvalidRead>;
  };

  /** Visible to `candidates` only after its observation and line are durable. */
  readonly append: (input: TakingInput, outcome: Outcome) => Effect.Effect<Taking, InvalidRead>;
  readonly capture: CaptureLatch;
  readonly readSets: RecordingReader["readSets"] & {
    /** Durable before it resolves (temp file, then rename); counted against the bundle's bytes. */
    readonly keep: (record: InputReadSetRecord) => Effect.Effect<void, InvalidRead>;
  };
}

/** The canonical lane with this host's opened stores: live captures through a writer, a recording
 * replays through a reader, and a fixture has no native source. */
export type HostInputLane =
  | (Extract<InputLane<RecordingWriter>, { kind: "live" }> & {
      /** Automatic capture that never opened its store: live input, truncated before any taking. */
      readonly captureSetup?: Truncation;
    })
  | Extract<InputLane<never>, { kind: "fixture" }>
  | (Extract<InputLane<RecordingReader>, { kind: "recording" }> & {
      /** `at` resolved to taking ids until Timeline epochs bind them; never crosses the scope fence. */
      readonly bindings?: ReadonlyMap<string, string>;
    });

const plainClasses = { InvalidRequest: InvalidRead, ReadBusy, ReadRetiring } as const;
/** The live failure as its class records it, or None when replay could not rebuild it exactly. */
const failureOf = (error: DoorFailure): Option.Option<typeof failure.Type> => {
  if (error instanceof Refused)
    return Option.map(Schema.decodeUnknownOption(Schema.Json)(error.refusal), (refusal) => ({
      tag: "Refused" as const,
      refusal,
    }));
  if (error instanceof BridgeError)
    return Option.map(Schema.decodeUnknownOption(recordedEvidence)(error.evidence), (evidence) => ({
      tag: "BridgeError" as const,
      message: error.message,
      status: error.status,
      problem: error.problem,
      ...(error.nativeOutcome ? { nativeOutcome: error.nativeOutcome } : {}),
      evidence,
    }));
  for (const [tag, Class] of Object.entries(plainClasses))
    if (error instanceof Class)
      return Option.some({
        tag: tag as keyof typeof plainClasses,
        message: error.message,
        status: error.status,
        problem: error.problem,
      });
  return Option.none();
};
// Domain refusals, or a native failure whose own evidence says nothing reached Revit.
const outcomeOf = (error: DoorFailure, recorded: typeof failure.Type): Outcome => ({
  kind: error instanceof BridgeError && error.outcome !== "refused" ? "unknown" : "refused",
  failure: recorded,
});
/** A live failure as a recorded outcome, or a capture refusal when replay could not rebuild it. */
const recordedFailure = (error: DoorFailure) =>
  Option.match(failureOf(error), {
    onSome: (recorded) => Effect.succeed(outcomeOf(error, recorded)),
    onNone: () =>
      Effect.fail(
        refuse("unsupported", `A ${error._tag} failure cannot be recorded faithfully`, 501),
      ),
  });
/**
 * The one taking that answers an input in a scope: an exact binding when the root supplied one,
 * otherwise the only taking recorded for that scope.
 */
export const chooseTaking = Effect.fn("Recording.choose")(function* (
  store: RecordingReader,
  identity: string,
  scope: string,
  what: string,
  bound?: string,
) {
  const candidates = store.candidates(identity);
  const chosen =
    bound === undefined
      ? candidates.filter((taking) => taking.scope === scope)
      : candidates.filter((taking) => taking.id === bound);
  if (bound !== undefined && chosen.length === 0)
    return yield* refuse("mismatch", "The bound taking does not record this input");
  if (candidates.length === 0)
    return yield* refuse("miss", `The recording holds no taking of ${what} for this input`);
  // Until epochs bind documents, a recording serves only the exact scope it recorded.
  if (chosen.length === 0 || chosen.some((taking) => taking.scope !== scope))
    return yield* refuse("scope", `The recording of ${what} was taken for another scope`);
  if (chosen.length > 1)
    return yield* refuse(
      "ambiguous",
      `The recording holds ${chosen.length} takings of ${what} for this input; bind one`,
    );
  return chosen[0]!;
});
export const replayFailure = Effect.fn("Recording.failure")(function* (recorded: typeof failure.Type) {
  if (recorded.tag === "Refused") {
    const refusal = refusalSchema.safeParse(recorded.refusal);
    if (!refusal.success) return yield* refuse("tamper", "Recorded refusal is damaged");
    return new Refused(refusal.data);
  }
  if (recorded.tag === "BridgeError")
    return new BridgeError({
      message: recorded.message,
      status: recorded.status,
      problem: recorded.problem,
      ...(recorded.nativeOutcome ? { nativeOutcome: recorded.nativeOutcome } : {}),
      evidence: recorded.evidence,
    });
  const { tag, ...fields } = recorded;
  return new plainClasses[tag](fields);
});

/** The bounded reason a capture could not be kept; never a path or a message. */
const reasonOf = (cause: Cause.Cause<InvalidRead>): Truncation["reason"] => {
  const problem = Option.getOrUndefined(Cause.findErrorOption(cause))?.problem;
  return problem === "recording.full"
    ? "full"
    : problem === "recording.observer"
      ? "observer"
    : problem === "recording.unsupported"
      ? "unsupported"
      : problem === "recording.input"
        ? "encoding"
        : "io";
};
/**
 * Automatic capture around one live read. Live runs exactly once and its exit is returned
 * unchanged; a taking that cannot be described or kept stops the writer's capture at this attempt.
 */
export type Occurrence = { readonly input: RecordedInput; readonly scope: string };
export const captured = <A, E, R>(
  writer: RecordingWriter,
  op: string,
  live: Effect.Effect<A, E, R>,
  record: (
    exit: Exit.Exit<A, E>,
  ) => Effect.Effect<
    { readonly input: TakingInput; readonly outcome: Outcome } | null,
    InvalidRead
  >,
  observed: TakingObserver = unobserved,
  occurrence: Effect.Effect<Occurrence | undefined> = Effect.succeed(undefined),
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const at = writer.capture.begin();
    // The occurrence is reserved at START, before the live read can await anything.
    const reserve = at === null ? undefined : yield* occurrence;
    const attempt = reserve ? yield* attemptFor(reserve.input, reserve.scope) : null;
    const exit = yield* Effect.exit(live);
    if (at === null) return yield* exit;
    // A consumer whose occurrence cannot be reserved loses capture, not its live answer (K4).
    if (attempt && Result.isFailure(attempt)) {
      yield* writer.capture.stop(at, "unsupported", { site: "occurrence", op });
      return yield* exit;
    }
    const bind: TakingObserver = attempt
      ? (stored) => Effect.andThen(attempt.success.observed(stored), observed(stored))
      : observed;
    const kept = yield* Effect.exit(
      Effect.flatMap(record(exit), (taking) =>
        taking === null || writer.capture.truncated()
          ? Effect.void
          : writer.append(taking.input, taking.outcome).pipe(
              Effect.flatMap((stored) => bind(stored).pipe(
                Effect.mapError(() => refuse("observer", "Taking observer failed")),
              )),
            ),
      ),
    );
    if (Exit.isFailure(kept)) yield* writer.capture.stop(at, reasonOf(kept.cause),
      { site: Exit.isFailure(exit) ? "failure" : "json", op });
    return yield* exit;
  });
/** A live failure as its recorded outcome, or null for an interrupted read, which is no taking. */
export const failedOutcome = <A>(exit: Exit.Exit<A, DoorFailure>) => {
  if (Exit.isSuccess(exit)) return Effect.succeed(null);
  const error = Cause.findErrorOption(exit.cause);
  return Option.isNone(error) ? Effect.succeed(null) : recordedFailure(error.value);
};

/** The owner's value as the canonical JSON its codec encodes; anything else cannot be kept. */
const encoded = <A, I>(codec: Schema.Codec<A, I>, value: A) =>
  Schema.encodeUnknownEffect(codec)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
    Effect.mapError(() => refuse("unsupported", "This input value is not recordable JSON", 501)),
  );

/**
 * One owner's live read, kept as a taking before its answer is returned. A value or a
 * class-faithful failure is recorded; a capture failure stops recording without changing the live exit.
 */
/** An occurrence must agree with an explicit binding; only an unowned read uses the binding alone. */
export const selectedFor = (input: RecordedInput, scope: string, bound: string | undefined) =>
  Effect.flatMap(attemptFor(input, scope), (attempt) =>
    attempt === null
      ? Effect.succeed(bound)
      : Result.isFailure(attempt)
        ? Effect.fail(attempt.failure)
        : attempt.success.selected.pipe(
            Effect.flatMap((selected) =>
              bound === undefined || bound === selected
                ? Effect.succeed(selected)
                : Effect.fail(refuse("mismatch", "The bound taking differs from the consumer occurrence")),
            ),
          ),
  );

export const captureInput = <A, I>(
  writer: RecordingWriter,
  input: RecordedInput,
  scope: string,
  codec: Schema.Codec<A, I>,
  live: Effect.Effect<A, DoorFailure>,
  observed: TakingObserver = unobserved,
  op = input.kind === "native" || input.kind === "publication" ? input.key : input.kind === "work" ? `work.${input.view}`
    : input.kind === "files" ? `files.${input.file}` : input.kind === "marks"
      ? `marks.${input.frame === null ? "snapshot" : "frame"}` : input.kind,
): Effect.Effect<A, DoorFailure> =>
  captured(writer, op, live, (exit) =>
    Effect.gen(function* () {
      const outcome: Outcome | null = Exit.isSuccess(exit)
        ? { kind: "observed", value: yield* encoded(codec, exit.value) }
        : yield* failedOutcome(exit);
      return outcome && { input: { input, scope, outputVersion: BUILD_VERSION }, outcome };
    }),
    observed,
    Effect.succeed({ input, scope }),
  );

/** The one recorded answer to an owner's read in this scope, decoded by that owner's codec. */
export const replayInput = <A, I>(
  reader: RecordingReader,
  input: RecordedInput,
  scope: string,
  codec: Schema.Codec<A, I>,
  boundTakingId?: string,
): Effect.Effect<A, DoorFailure> =>
  Effect.gen(function* () {
    const taking = yield* chooseTaking(
      reader,
      inputIdentity(input),
      scope,
      input.kind,
      yield* selectedFor(input, scope, boundTakingId),
    );
    if (taking.outputVersion !== BUILD_VERSION || taking.outcome.kind === "answered")
      return yield* refuse("mismatch", `The taking of ${input.kind} is not an owner observation`);
    if (taking.outcome.kind !== "observed")
      return yield* Effect.fail(yield* replayFailure(taking.outcome.failure));
    const raw = yield* reader.observation(taking);
    return yield* Schema.decodeUnknownEffect(codec)(raw).pipe(
      Effect.mapError(() =>
        refuse("mismatch", `Recorded ${input.kind === "files" ? `files.${input.file}` : input.kind} no longer satisfies its owner's contract`),
      ),
    );
  });

/** One native input's identity: its key and the canonical JSON of the request input. */
export const nativeInputIdentity = (request: NativeReadInput) =>
  recordedNativeArgs(request).pipe(
    Effect.map((args) => inputIdentity({ kind: "native", key: request.key, args })),
  );
export const recordedNativeJson = (value: unknown, what: string) =>
  Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.map(canonicalJson),
    Effect.mapError(() => refuse("input", `Native ${what} is not JSON`, 400)),
  );
export const recordedNativeArgs = (request: NativeReadInput) => recordedNativeJson(request.input, "input");
