/**
 * Host input recording (ADR 0031 rules 1, 2 and 5). One bundle of takings answers the host's input
 * services: native reads through `HostNativeRead`, and every other owner (files, marks, inventory,
 * Work) through `captureInput`/`replayInput` with that owner's codec. A miss refuses and never
 * reaches a live input. Coverage is only the kinds a bundle durably holds, never a whole document.
 */
import { randomUUID, createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cause, Clock, Effect, Exit, Layer, Option, Schema } from "effect";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { validationIssueSchema } from "@pe/host-contracts/contracts";
import { BridgeError } from "@pe/host-internal/dispatch";
import { HostNativeRead, canonicalJson, type NativeReadInput } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { admitNativeCaller } from "./native-read-policy.ts";
import {
  refusalSchema,
  truncationSchema,
  type InputKind,
  type InputLane,
  type Truncation,
} from "@pe/agent-contracts";
import { Refused } from "./control.ts";
import { InvalidRead, ReadBusy, ReadRetiring } from "./native-reads.ts";
import { readSchemas } from "./request-services.ts";

export interface RecordingIdentity {
  readonly build: string;
  readonly catalog: string;
}
export interface RecordingBounds {
  readonly maxBytes: number;
  readonly maxTakings: number;
}
/** The generated native catalog a bundle was recorded against; any contract change is a new bundle. */
export const nativeCatalogIdentity = () =>
  createHash("sha256").update(JSON.stringify(hostOpCatalog)).digest("hex");

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
const sha256Name = Schema.String.check(
  Schema.makeFilter((name) => /^[0-9a-f]{64}$/.test(name) || "Observation name is not a SHA-256"),
);
// Format 3: the marks input carries its frame. Older formats are refused, never migrated.
const FORMAT = 3;
/** What one taking recorded: a native read, or one input owner's exact read shape. */
const recordedInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("native"), key: Schema.String, args: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("document"), scope: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("files"),
    file: Schema.Literals(["firm", "duct-catalogs"]),
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
const takingSchema = Schema.Struct({
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
type TakingInput = Pick<Taking, "input" | "scope" | "outputVersion">;
type Answered = Extract<Taking["outcome"], { kind: "answered" }>;
type Outcome =
  | {
      readonly kind: "answered";
      readonly value: Schema.Json;
      readonly answer: Omit<Answered, "kind" | "observation">;
    }
  | { readonly kind: "observed"; readonly value: Schema.Json }
  | Exclude<Taking["outcome"], { kind: "answered" | "observed" }>;
const manifestSchema = Schema.Struct({
  version: Schema.Literal(FORMAT),
  build: Schema.String,
  catalog: Schema.String,
});
/** Non-native codecs belong to the build, and the manifest already fixes the build. */
const BUILD_VERSION = "build";

const TRUNCATION = "truncation.json";
const refuse = (problem: string, message: string, status = 409) =>
  new InvalidRead({ message, status, problem: `recording.${problem}` });
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => refuse("io", String(error), 500) });
const missing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";
const observationSha = (kind: string, outputVersion: string, bytes: string) =>
  createHash("sha256").update(`${kind}\n${outputVersion}\n${bytes}`).digest("hex");
/** One input's identity across takings: its whole canonical discriminant. */
export const inputIdentity = (input: RecordedInput) => canonicalJson(input);
/** The root's explicit binding key for one non-native input occurrence: its identity and its scope. */
export const inputBindingKey = (input: RecordedInput, scope: string) =>
  canonicalJson([inputIdentity(input), scope]);
/**
 * A host-owned provenance port: told the exact durable taking a capture just appended, before the
 * read answers. Observer failure truncates capture, preserving the actual live result (K4).
 */
export type TakingObserver = (taking: Taking) => Effect.Effect<void, DoorFailure>;
const unobserved: TakingObserver = () => Effect.void;
const observationOf = (taking: Taking) =>
  taking.outcome.kind === "answered" || taking.outcome.kind === "observed"
    ? taking.outcome.observation
    : null;

/** A historical bundle, read only: replay can select and read takings but never add one. */
export interface RecordingReader {
  readonly identity: RecordingIdentity;
  /** Every taking of one input identity, oldest first; equal bytes never merge takings. */
  readonly candidates: (identity: string) => readonly Taking[];
  readonly taking: (id: string) => Taking | undefined;
  readonly observation: (taking: Taking) => Effect.Effect<Schema.Json, InvalidRead>;
  /** The kinds with at least one durable taking: coarse, never proof that a read set is served. */
  readonly coverage: () => readonly InputKind[];
  /** Where automatic capture stopped, when its marker was kept; such a bundle is not complete. */
  readonly truncation: Truncation | null;
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
  readonly stop: (at: number, reason: Truncation["reason"]) => Effect.Effect<void>;
}
/** The one capture writer of a bundle in this process (no cross-process lock is claimed). */
export interface RecordingWriter extends RecordingReader {
  /** Visible to `candidates` only after its observation and line are durable. */
  readonly append: (input: TakingInput, outcome: Outcome) => Effect.Effect<Taking, InvalidRead>;
  readonly capture: CaptureLatch;
}

/**
 * Decodes one bundle for either side: manifest identity, size-bounded files, hash-named
 * observations. Only a capture writer may create a missing bundle; a reader refuses and writes nothing.
 */
const loadBundle = Effect.fn("Recording.load")(function* (
  dir: string,
  identity: RecordingIdentity,
  bounds: RecordingBounds,
  create: boolean,
) {
  const manifestPath = join(dir, "manifest.json");
  const takingsPath = join(dir, "takings.jsonl");
  const observations = join(dir, "observations");
  const manifest = { version: FORMAT, ...identity } as const;
  // Every file's size is checked against the bound before it is loaded.
  const bounded = (path: string, fallback: string | null) =>
    io(() =>
      stat(path).then(
        (found) => found.size,
        (error: unknown) => (missing(error) ? null : Promise.reject(error)),
      ),
    ).pipe(
      Effect.flatMap((size) =>
        size === null
          ? Effect.succeed(fallback)
          : size > bounds.maxBytes
            ? Effect.fail(refuse("full", `${path} exceeds the recording bound`, 507))
            : io(() => readFile(path, "utf8")),
      ),
    );
  const existing = yield* bounded(manifestPath, null);
  if (existing === null) {
    if (!create) return yield* refuse("missing", `No recording bundle at ${dir}`, 404);
    yield* io(() => mkdir(observations, { recursive: true }));
    yield* io(() => writeFile(manifestPath, JSON.stringify(manifest)));
  } else {
    const format = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Struct({ version: Schema.Json })),
    )(existing).pipe(Effect.mapError(() => refuse("tamper", "Recording manifest is damaged")));
    // No migration: a bundle of another format is refused, never read through a shim.
    if (format.version !== FORMAT)
      return yield* refuse(
        "mismatch",
        `Recording format ${JSON.stringify(format.version)} is not format ${FORMAT}; record it again`,
      );
    const found = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(manifestSchema))(
      existing,
    ).pipe(Effect.mapError(() => refuse("tamper", "Recording manifest is damaged")));
    if (found.build !== identity.build || found.catalog !== identity.catalog)
      return yield* refuse(
        "mismatch",
        `Recording was made by build ${found.build} against another catalog; it cannot answer this host`,
      );
  }
  const text = (yield* bounded(takingsPath, "")) ?? "";
  const takings: Taking[] = [];
  for (const line of text.split("\n").filter((line) => line.trim()))
    takings.push(
      yield* Schema.decodeUnknownEffect(Schema.fromJsonString(takingSchema))(line).pipe(
        Effect.mapError(() => refuse("tamper", "Recording takings are damaged")),
      ),
    );
  const stored = new Set<string>();
  let used = Buffer.byteLength(text) + Buffer.byteLength(JSON.stringify(manifest));
  for (const taking of takings) {
    const sha = observationOf(taking);
    if (sha !== null && !stored.has(sha)) {
      stored.add(sha);
      used += (yield* io(() => stat(join(observations, `${sha}.json`)))).size;
    }
  }
  if (used > bounds.maxBytes || takings.length > bounds.maxTakings)
    return yield* refuse("full", "Recording exceeds its bounds", 507);
  const marker = yield* bounded(join(dir, TRUNCATION), null);
  const truncation =
    marker === null
      ? null
      : yield* Effect.try({
          try: () => truncationSchema.parse(JSON.parse(marker)),
          catch: () => refuse("tamper", "Recording truncation marker is damaged"),
        });
  const reader: RecordingReader = {
    identity,
    candidates: (wanted: string) =>
      takings.filter((taking) => inputIdentity(taking.input) === wanted),
    taking: (id: string) => takings.find((taking) => taking.id === id),
    observation: Effect.fn("Recording.observation")(function* (taking: Taking) {
      const sha = observationOf(taking);
      if (sha === null) return yield* refuse("miss", "This taking holds no observation");
      const bytes = (yield* bounded(join(observations, `${sha}.json`), null)) ?? "";
      if (observationSha(taking.input.kind, taking.outputVersion, bytes) !== sha)
        return yield* refuse("tamper", `Observation ${sha} does not hash to its name`);
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(bytes).pipe(
        Effect.mapError(() => refuse("tamper", `Observation ${sha} is not JSON`)),
      );
    }),
    coverage: () => [...new Set(takings.map((taking) => taking.input.kind))],
    truncation,
  };
  return { reader, takings, stored, used, takingsPath, observations };
});

/** Opens an existing bundle for replay. A missing, damaged, foreign or oversized bundle refuses. */
export const openRecordingReader = (
  dir: string,
  identity: RecordingIdentity,
  bounds: RecordingBounds,
): Effect.Effect<RecordingReader, InvalidRead> =>
  loadBundle(dir, identity, bounds, false).pipe(Effect.map((bundle) => bundle.reader));

/** Opens or creates the bundle capture appends to, under the same identity and bounds checks. */
export const openRecordingWriter = Effect.fn("Recording.writer")(function* (
  dir: string,
  identity: RecordingIdentity,
  bounds: RecordingBounds,
) {
  const { reader, takings, stored, takingsPath, observations, ...loaded } = yield* loadBundle(
    dir,
    identity,
    bounds,
    true,
  );
  let used = loaded.used;
  let attempts = 0;
  let truncated = reader.truncation;
  // In-flight observation writes, so two equal observations share one durable write.
  const writing = new Map<string, Promise<void>>();
  let reserved = 0;
  const clock = yield* Clock.Clock;
  const writeObservation = (sha: string, bytes: string) => {
    const path = join(observations, `${sha}.json`);
    const write = writeFile(path, bytes, { flag: "wx" })
      .catch(async (error: unknown) => {
        // A blob left by an earlier failed append is reused only if it hashes to its name.
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        if ((await readFile(path, "utf8")) !== bytes) throw error;
      })
      .then(() => {
        stored.add(sha);
      })
      .finally(() => writing.delete(sha));
    writing.set(sha, write);
    return write;
  };
  return {
    ...reader,
    get truncation() {
      return truncated;
    },
    capture: {
      begin: () => (truncated ? null : ++attempts),
      truncated: () => truncated,
      stop: (at, reason) =>
        Effect.suspend(() => {
          if (truncated) return Effect.void;
          truncated = { at, reason };
          // ponytail: best-effort marker; on an already failed disk only this process knows.
          return io(() => writeFile(join(dir, TRUNCATION), JSON.stringify(truncated))).pipe(
            Effect.orElseSucceed(() => undefined),
          );
        }),
    },
    append: Effect.fn("Recording.append")(function* (input: TakingInput, outcome: Outcome) {
      const holds = outcome.kind === "answered" || outcome.kind === "observed";
      const bytes = holds ? canonicalJson(outcome.value) : "";
      const sha = holds ? observationSha(input.input.kind, input.outputVersion, bytes) : "";
      const taking: Taking = {
        version: FORMAT,
        id: randomUUID(),
        at: clock.currentTimeMillisUnsafe(),
        ...input,
        outcome:
          outcome.kind === "answered"
            ? { kind: "answered", observation: sha, ...outcome.answer }
            : outcome.kind === "observed"
              ? { kind: "observed", observation: sha }
              : outcome,
      };
      const line = `${JSON.stringify(taking)}\n`;
      const shared = !holds || stored.has(sha) || writing.has(sha);
      const blob = shared ? 0 : Buffer.byteLength(bytes);
      const need = Buffer.byteLength(line) + blob;
      // The reservation is taken before any await, so concurrent takings cannot pass the bound together.
      if (takings.length + reserved + 1 > bounds.maxTakings || used + need > bounds.maxBytes)
        return yield* refuse(
          "full",
          `Recording is full (${used} of ${bounds.maxBytes} bytes, ${takings.length} of ${bounds.maxTakings} takings); this taking was not kept`,
          507,
        );
      used += need;
      reserved++;
      const durable = yield* Effect.exit(
        io(async () => {
          if (holds && !stored.has(sha)) await (writing.get(sha) ?? writeObservation(sha, bytes));
          await appendFile(takingsPath, line);
        }),
      );
      reserved--;
      if (Exit.isFailure(durable)) {
        // A durable blob stays counted; only the bytes never written are released.
        used -= Buffer.byteLength(line) + (blob && !stored.has(sha) ? blob : 0);
        return yield* Effect.failCause(durable.cause);
      }
      takings.push(taking);
      return taking;
    }),
  } satisfies RecordingWriter;
});

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

/** One native input's identity: its key and the canonical JSON of the request input. */
export const nativeInputIdentity = (request: NativeReadInput) =>
  argsOf(request).pipe(
    Effect.map((args) => inputIdentity({ kind: "native", key: request.key, args })),
  );
const json = (value: unknown, what: string) =>
  Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.map(canonicalJson),
    Effect.mapError(() => refuse("input", `Native ${what} is not JSON`, 400)),
  );
const argsOf = (request: NativeReadInput) => json(request.input, "input");
const scopeOf = (request: NativeReadInput) => json(request.scope, "scope");
const versionOf = (key: string) =>
  readSchemas(key).pipe(
    Effect.map((schemas) => schemas.version),
    Effect.orElseSucceed(() => "no-contract"),
  );

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
const chooseTaking = Effect.fn("Recording.choose")(function* (
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
const replayFailure = Effect.fn("Recording.failure")(function* (recorded: typeof failure.Type) {
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
const captured = <A, E, R>(
  writer: RecordingWriter,
  live: Effect.Effect<A, E, R>,
  record: (
    exit: Exit.Exit<A, E>,
  ) => Effect.Effect<
    { readonly input: TakingInput; readonly outcome: Outcome } | null,
    InvalidRead
  >,
  observed: TakingObserver = unobserved,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const at = writer.capture.begin();
    const exit = yield* Effect.exit(live);
    if (at === null) return yield* exit;
    const kept = yield* Effect.exit(
      Effect.flatMap(record(exit), (taking) =>
        taking === null || writer.capture.truncated()
          ? Effect.void
          : writer.append(taking.input, taking.outcome).pipe(
              Effect.flatMap((stored) => observed(stored).pipe(
                Effect.mapError(() => refuse("observer", "Taking observer failed")),
              )),
            ),
      ),
    );
    if (Exit.isFailure(kept)) yield* writer.capture.stop(at, reasonOf(kept.cause));
    return yield* exit;
  });
/** A live failure as its recorded outcome, or null for an interrupted read, which is no taking. */
const failedOutcome = <A>(exit: Exit.Exit<A, DoorFailure>) => {
  if (Exit.isSuccess(exit)) return Effect.succeed(null);
  const error = Cause.findErrorOption(exit.cause);
  return Option.isNone(error) ? Effect.succeed(null) : recordedFailure(error.value);
};

/** Live reads, captured into `store` while its capture has not stopped. */
const capturing = (store: RecordingWriter, observed: TakingObserver) =>
  Layer.effect(
    HostNativeRead,
    Effect.gen(function* () {
      const live = yield* HostNativeRead;
      return {
        resolve: live.resolve,
        read: (request) =>
          captured(store, live.read(request), (exit) =>
            Effect.gen(function* () {
              const outcome: Outcome | null = Exit.isSuccess(exit)
                ? {
                    kind: "answered",
                    value: exit.value.value,
                    answer: {
                      nativeRequestId: exit.value.nativeRequestId,
                      actualTarget: exit.value.actualTarget,
                      freshness: { freshnessGeneration: exit.value.freshness.freshnessGeneration },
                      cost: exit.value.cost,
                      nativeOutcome: exit.value.outcome,
                    },
                  }
                : yield* failedOutcome(exit);
              if (outcome === null) return null;
              const input = {
                input: { kind: "native" as const, key: request.key, args: yield* argsOf(request) },
                scope: yield* scopeOf(request),
                outputVersion: yield* versionOf(request.key),
              };
              return { input, outcome };
            }),
            observed,
          ),
      };
    }),
  );

/** Recorded reads only: no live layer is built, and a miss is a typed refusal. */
const replaying = (store: RecordingReader, bindings: ReadonlyMap<string, string> = new Map()) => {
  const select = Effect.fn("Recording.select")(function* (request: NativeReadInput) {
    yield* admitNativeCaller(request.key);
    const args = yield* argsOf(request);
    const identity = inputIdentity({ kind: "native", key: request.key, args });
    const taking = yield* chooseTaking(
      store,
      identity,
      yield* scopeOf(request),
      request.key,
      bindings.get(identity),
    );
    if (taking.outputVersion !== (yield* versionOf(request.key)))
      return yield* refuse(
        "mismatch",
        `${request.key} changed its output contract since this recording`,
      );
    if (taking.outcome.kind === "observed")
      return yield* refuse("tamper", `The taking of ${request.key} holds no native answer`);
    if (taking.outcome.kind !== "answered")
      return yield* Effect.fail(yield* replayFailure(taking.outcome.failure));
    return { taking, answer: taking.outcome, args };
  });
  return Layer.succeed(HostNativeRead, {
    resolve: (request) =>
      select(request).pipe(
        Effect.map(({ answer, args }) => ({
          operationKey: request.key,
          ...answer.actualTarget,
          normalizedInput: args,
          freshnessGeneration: answer.freshness.freshnessGeneration,
          representation: "overview" as const,
        })),
      ),
    read: (request) =>
      Effect.gen(function* () {
        const { taking, answer } = yield* select(request);
        const raw = yield* store.observation(taking);
        const schemas = yield* readSchemas(request.key);
        const value = yield* Schema.decodeUnknownEffect(schemas.response)(raw).pipe(
          Effect.mapError(() =>
            refuse("mismatch", `Recorded ${request.key} no longer satisfies its contract`),
          ),
        );
        return {
          value,
          nativeRequestId: answer.nativeRequestId,
          actualTarget: answer.actualTarget,
          freshness: answer.freshness,
          cost: answer.cost,
          outcome: answer.nativeOutcome,
        };
      }),
  });
};

/** The composition's one choice of native input; the live layer is only built on the live lane. */
export const hostNativeReadFor = <R>(
  lane: HostInputLane,
  live: Layer.Layer<HostNativeRead, never, R>,
  observed: TakingObserver = unobserved,
): Layer.Layer<HostNativeRead, never, R> =>
  lane.kind === "recording"
    ? replaying(lane.recordingStore, lane.bindings)
    : lane.kind === "fixture"
      ? sourceless(lane.name)
      : lane.captureStore
        ? capturing(lane.captureStore, observed).pipe(Layer.provide(live))
        : live;

/** A host fixture with no input adapter: every read refuses, and live is never built. */
const sourceless = (name: string) => {
  const refusal = Effect.fail(
    refuse("fixture", `Host fixture '${name}' has no native input source`),
  );
  return Layer.succeed(HostNativeRead, { resolve: () => refusal, read: () => refusal });
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
export const captureInput = <A, I>(
  writer: RecordingWriter,
  input: RecordedInput,
  scope: string,
  codec: Schema.Codec<A, I>,
  live: Effect.Effect<A, DoorFailure>,
  observed: TakingObserver = unobserved,
): Effect.Effect<A, DoorFailure> =>
  captured(writer, live, (exit) =>
    Effect.gen(function* () {
      const outcome: Outcome | null = Exit.isSuccess(exit)
        ? { kind: "observed", value: yield* encoded(codec, exit.value) }
        : yield* failedOutcome(exit);
      return outcome && { input: { input, scope, outputVersion: BUILD_VERSION }, outcome };
    }),
    observed,
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
      boundTakingId,
    );
    if (taking.outputVersion !== BUILD_VERSION || taking.outcome.kind === "answered")
      return yield* refuse("mismatch", `The taking of ${input.kind} is not an owner observation`);
    if (taking.outcome.kind !== "observed")
      return yield* Effect.fail(yield* replayFailure(taking.outcome.failure));
    const raw = yield* reader.observation(taking);
    return yield* Schema.decodeUnknownEffect(codec)(raw).pipe(
      Effect.mapError(() =>
        refuse("mismatch", `Recorded ${input.kind} no longer satisfies its owner's contract`),
      ),
    );
  });
