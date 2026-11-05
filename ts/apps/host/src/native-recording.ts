/**
 * Native-input recording (ADR 0031 rules 1, 2 and 5; Step 7.2 first slice). A recording answers
 * `HostNativeRead` from a local bundle of takings; a miss refuses and never reaches a live input.
 * Coverage is native reads only: a bundle never claims a whole document or the other input services.
 */
import { randomUUID, createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cause, Clock, Effect, Exit, Layer, Option, Schema } from "effect";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { validationIssueSchema } from "@pe/host-contracts/contracts";
import { BridgeError } from "@pe/host-internal/dispatch";
import { HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { canonicalJson } from "../../../packages/host-internal/src/read-admission.ts";
import { admitNativeCaller } from "./native-read-policy.ts";
import { refusalSchema, type InputLane } from "@pe/agent-contracts";
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
const takingSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  at: Schema.Number,
  input: Schema.Struct({
    kind: Schema.Literal("native-read"),
    key: Schema.String,
    args: Schema.String,
  }),
  /** Canonical JSON of the request's explicit scope; replay serves only that scope. */
  scope: Schema.String,
  outputVersion: Schema.String,
  coverage: Schema.Literal("native-only"),
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
  | Exclude<Taking["outcome"], { kind: "answered" }>;
const manifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  build: Schema.String,
  catalog: Schema.String,
  coverage: Schema.Struct({
    kind: Schema.Literal("partial"),
    inputs: Schema.Tuple([Schema.Literal("native-read")]),
  }),
});

const refuse = (problem: string, message: string, status = 409) =>
  new InvalidRead({ message, status, problem: `recording.${problem}` });
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => refuse("io", String(error), 500) });
const missing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";
const observationSha = (outputVersion: string, bytes: string) =>
  createHash("sha256").update(`native-read\n${outputVersion}\n${bytes}`).digest("hex");
const identityOf = (key: string, args: string) => canonicalJson(["native-read", key, args]);

/** A historical bundle, read only: replay can select and read takings but never add one. */
export interface RecordingReader {
  readonly identity: RecordingIdentity;
  /** Every taking of one input identity, oldest first; equal bytes never merge takings. */
  readonly candidates: (identity: string) => readonly Taking[];
  readonly taking: (id: string) => Taking | undefined;
  readonly observation: (taking: Taking) => Effect.Effect<Schema.Json, InvalidRead>;
}
/** The one capture writer of a bundle in this process (no cross-process lock is claimed). */
export interface RecordingWriter extends RecordingReader {
  /** Visible to `candidates` only after its observation and line are durable. */
  readonly append: (input: TakingInput, outcome: Outcome) => Effect.Effect<Taking, InvalidRead>;
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
  const manifest = {
    version: 1,
    ...identity,
    coverage: { kind: "partial", inputs: ["native-read"] },
  } as const;
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
  for (const taking of takings)
    if (taking.outcome.kind === "answered" && !stored.has(taking.outcome.observation)) {
      const sha = taking.outcome.observation;
      stored.add(sha);
      used += (yield* io(() => stat(join(observations, `${sha}.json`)))).size;
    }
  if (used > bounds.maxBytes || takings.length > bounds.maxTakings)
    return yield* refuse("full", "Recording exceeds its bounds", 507);
  const reader: RecordingReader = {
    identity,
    candidates: (wanted: string) =>
      takings.filter((taking) => identityOf(taking.input.key, taking.input.args) === wanted),
    taking: (id: string) => takings.find((taking) => taking.id === id),
    observation: Effect.fn("Recording.observation")(function* (taking: Taking) {
      if (taking.outcome.kind !== "answered")
        return yield* refuse("miss", "This taking holds no observation");
      const sha = taking.outcome.observation;
      const bytes = (yield* bounded(join(observations, `${sha}.json`), null)) ?? "";
      if (observationSha(taking.outputVersion, bytes) !== sha)
        return yield* refuse("tamper", `Observation ${sha} does not hash to its name`);
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(bytes).pipe(
        Effect.mapError(() => refuse("tamper", `Observation ${sha} is not JSON`)),
      );
    }),
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
    append: Effect.fn("Recording.append")(function* (input: TakingInput, outcome: Outcome) {
      const bytes = outcome.kind === "answered" ? canonicalJson(outcome.value) : "";
      const sha = outcome.kind === "answered" ? observationSha(input.outputVersion, bytes) : "";
      const taking: Taking = {
        version: 1,
        id: randomUUID(),
        at: clock.currentTimeMillisUnsafe(),
        ...input,
        coverage: "native-only",
        outcome:
          outcome.kind === "answered"
            ? { kind: "answered", observation: sha, ...outcome.answer }
            : outcome,
      };
      const line = `${JSON.stringify(taking)}\n`;
      const shared = outcome.kind !== "answered" || stored.has(sha) || writing.has(sha);
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
          if (outcome.kind === "answered" && !stored.has(sha))
            await (writing.get(sha) ?? writeObservation(sha, bytes));
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
  | Extract<InputLane<RecordingWriter>, { kind: "live" }>
  | Extract<InputLane<never>, { kind: "fixture" }>
  | (Extract<InputLane<RecordingReader>, { kind: "recording" }> & {
      /** `at` resolved to taking ids until Timeline epochs bind them; never crosses the scope fence. */
      readonly bindings?: ReadonlyMap<string, string>;
    });

/** One native input's identity: its key and the canonical JSON of the request input. */
export const nativeInputIdentity = (request: NativeReadInput) =>
  argsOf(request).pipe(Effect.map((args) => identityOf(request.key, args)));
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

/**
 * Live reads, captured into `store` when the lane asks. A taking that cannot be kept (full or
 * failed I/O) fails the read with that refusal, carrying the live read's dispatch evidence.
 */
const capturing = (store: RecordingWriter) =>
  Layer.effect(
    HostNativeRead,
    Effect.gen(function* () {
      const live = yield* HostNativeRead;
      return {
        resolve: live.resolve,
        read: (request) =>
          Effect.gen(function* () {
            const taking = {
              input: {
                kind: "native-read" as const,
                key: request.key,
                args: yield* argsOf(request),
              },
              scope: yield* scopeOf(request),
              outputVersion: yield* versionOf(request.key),
            };
            const exit = yield* Effect.exit(live.read(request));
            const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
            // An interrupted caller has no outcome to record; its read is not a taking.
            if (Exit.isFailure(exit) && Option.isNone(error)) return yield* exit;
            const outcome: Outcome = Exit.isSuccess(exit)
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
              : yield* Option.match(failureOf(Option.getOrThrow(error)), {
                  onSome: (recorded) =>
                    Effect.succeed(outcomeOf(Option.getOrThrow(error), recorded)),
                  // Replay could not rebuild this failure exactly, so no taking claims to hold it.
                  onNone: () =>
                    Effect.fail(
                      refuse(
                        "unsupported",
                        `A ${Option.getOrThrow(error)._tag} failure cannot be recorded faithfully`,
                        501,
                      ),
                    ),
                });
            const dispatch =
              outcome.kind === "answered"
                ? {
                    nativeOutcome: outcome.answer.nativeOutcome,
                    evidence: {
                      nativeRequestId: outcome.answer.nativeRequestId,
                      actualTarget: outcome.answer.actualTarget,
                    },
                  }
                : outcome.failure.tag === "BridgeError"
                  ? {
                      ...(outcome.failure.nativeOutcome
                        ? { nativeOutcome: outcome.failure.nativeOutcome }
                        : {}),
                      evidence: outcome.failure.evidence,
                    }
                  : {};
            yield* store.append(taking, outcome).pipe(
              Effect.mapError(
                (kept) =>
                  new BridgeError({
                    message: kept.message,
                    status: kept.status,
                    problem: kept.problem,
                    ...dispatch,
                  }),
              ),
            );
            return yield* exit;
          }),
      };
    }),
  );

/** Recorded reads only: no live layer is built, and a miss is a typed refusal. */
const replaying = (store: RecordingReader, bindings: ReadonlyMap<string, string> = new Map()) => {
  const select = Effect.fn("Recording.select")(function* (request: NativeReadInput) {
    yield* admitNativeCaller(request.key);
    const args = yield* argsOf(request);
    const scope = yield* scopeOf(request);
    const identity = identityOf(request.key, args);
    const candidates = store.candidates(identity);
    const bound = bindings.get(identity);
    const chosen =
      bound === undefined
        ? candidates.filter((taking) => taking.scope === scope)
        : candidates.filter((taking) => taking.id === bound);
    if (bound !== undefined && chosen.length === 0)
      return yield* refuse("mismatch", "The bound taking does not record this input");
    if (candidates.length === 0)
      return yield* refuse(
        "miss",
        `The recording holds no taking of ${request.key} for this input`,
      );
    // Until epochs bind documents, a recording serves only the exact scope it recorded.
    if (chosen.length === 0 || chosen.some((taking) => taking.scope !== scope))
      return yield* refuse("scope", `The recording of ${request.key} was taken for another scope`);
    if (chosen.length > 1)
      return yield* refuse(
        "ambiguous",
        `The recording holds ${chosen.length} takings of ${request.key} for this input; bind one`,
      );
    const taking = chosen[0]!;
    if (taking.outputVersion !== (yield* versionOf(request.key)))
      return yield* refuse(
        "mismatch",
        `${request.key} changed its output contract since this recording`,
      );
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
): Layer.Layer<HostNativeRead, never, R> =>
  lane.kind === "recording"
    ? replaying(lane.recordingStore, lane.bindings)
    : lane.kind === "fixture"
      ? sourceless(lane.name)
      : lane.captureStore
        ? capturing(lane.captureStore).pipe(Layer.provide(live))
        : live;

/** A host fixture with no input adapter: every read refuses, and live is never built. */
const sourceless = (name: string) => {
  const refusal = Effect.fail(refuse("fixture", `Host fixture '${name}' has no native input source`));
  return Layer.succeed(HostNativeRead, { resolve: () => refusal, read: () => refusal });
};
