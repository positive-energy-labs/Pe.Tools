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
import { BridgeError } from "@pe/host-internal/dispatch";
import { HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { canonicalJson } from "../../../packages/host-internal/src/read-admission.ts";
import { admitNativeCaller } from "./native-read-policy.ts";
import { InvalidRead } from "./native-reads.ts";
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
/** A recorded failure keeps what the live failure said, and leaves absent what it did not say. */
const failure = Schema.Struct({
  tag: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Number),
  problem: Schema.optionalKey(Schema.String),
  nativeOutcome: Schema.optionalKey(nativeOutcome),
  evidence: Schema.optionalKey(
    Schema.Struct({
      nativeRequestId: Schema.optionalKey(Schema.String),
      receiptId: Schema.optionalKey(Schema.String),
      actualTarget: Schema.optionalKey(actualTarget),
    }),
  ),
});
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

export interface RecordingStore {
  readonly identity: RecordingIdentity;
  /** Visible to `candidates` only after its observation and line are durable. */
  readonly append: (input: TakingInput, outcome: Outcome) => Effect.Effect<Taking, InvalidRead>;
  /** Every taking of one input identity, oldest first; equal bytes never merge takings. */
  readonly candidates: (identity: string) => readonly Taking[];
  readonly taking: (id: string) => Taking | undefined;
  readonly observation: (taking: Taking) => Effect.Effect<Schema.Json, InvalidRead>;
}

/** Opens or creates one bundle. A different build or catalog, a damaged line or an oversized file refuses. */
export const openRecordingStore = Effect.fn("Recording.open")(function* (
  dir: string,
  identity: RecordingIdentity,
  bounds: RecordingBounds,
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
    identity,
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
  } satisfies RecordingStore;
});

/** Where native reads come from (host-native only; not yet the canonical whole-product lane). */
export type InputLane =
  | { readonly kind: "live"; readonly capture?: RecordingStore }
  | {
      readonly kind: "recording";
      readonly store: RecordingStore;
      /** Input identity to taking id; a binding picks among takings but never crosses the scope fence. */
      readonly bindings?: ReadonlyMap<string, string>;
    };

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

/** What a live failure said, field by field; nothing is filled in that it did not say. */
const failureOf = (error: DoorFailure): typeof failure.Type => {
  const fields = error as Partial<
    Record<"status" | "problem" | "nativeOutcome" | "evidence", unknown>
  >;
  const evidence = Schema.decodeUnknownOption(failure.fields.evidence.schema)(fields.evidence);
  const outcome = Schema.decodeUnknownOption(nativeOutcome)(fields.nativeOutcome);
  return {
    tag: error._tag,
    message: error.message,
    ...(typeof fields.status === "number" ? { status: fields.status } : {}),
    ...(typeof fields.problem === "string" ? { problem: fields.problem } : {}),
    ...(Option.isSome(outcome) ? { nativeOutcome: outcome.value } : {}),
    ...(Option.isSome(evidence) && Object.keys(evidence.value).length
      ? { evidence: evidence.value }
      : {}),
  };
};
// Domain refusals, or a native failure that says nothing reached Revit; anything else is unknown.
const refusedTags = new Set([
  "InvalidRequest",
  "Refused",
  "NoRevitSession",
  "ReadBusy",
  "ReadRetiring",
  "CommandRejected",
]);
const outcomeOf = (error: DoorFailure): Outcome => {
  const recorded = failureOf(error);
  return {
    kind:
      refusedTags.has(error._tag) || recorded.nativeOutcome === "never-dispatched"
        ? "refused"
        : "unknown",
    failure: recorded,
  };
};
/** A recorded failure replays as itself where its class can carry every recorded field. */
const replayFailure = (recorded: typeof failure.Type): DoorFailure =>
  recorded.tag === "InvalidRequest" &&
  recorded.status !== undefined &&
  recorded.problem !== undefined &&
  !recorded.nativeOutcome &&
  !recorded.evidence
    ? new InvalidRead({
        message: recorded.message,
        status: recorded.status,
        problem: recorded.problem,
      })
    : new BridgeError({
        message:
          recorded.tag === "BridgeError"
            ? recorded.message
            : `${recorded.tag}: ${recorded.message}`,
        status: recorded.status ?? 503,
        problem: recorded.problem ?? `recorded.${recorded.tag}`,
        ...(recorded.nativeOutcome ? { nativeOutcome: recorded.nativeOutcome } : {}),
        ...(recorded.evidence ? { evidence: recorded.evidence } : {}),
      });

/**
 * Live reads, captured into `store` when the lane asks. A taking that cannot be kept (full or
 * failed I/O) fails the read with that refusal, carrying the live read's dispatch evidence.
 */
const capturing = (store: RecordingStore) =>
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
              : outcomeOf(Option.getOrThrow(error));
            const dispatch =
              outcome.kind === "answered"
                ? {
                    nativeOutcome: outcome.answer.nativeOutcome,
                    evidence: {
                      nativeRequestId: outcome.answer.nativeRequestId,
                      actualTarget: outcome.answer.actualTarget,
                    },
                  }
                : {
                    ...(outcome.failure.nativeOutcome
                      ? { nativeOutcome: outcome.failure.nativeOutcome }
                      : {}),
                    ...(outcome.failure.evidence ? { evidence: outcome.failure.evidence } : {}),
                  };
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
const replaying = (store: RecordingStore, bindings: ReadonlyMap<string, string> = new Map()) => {
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
      return yield* Effect.fail(replayFailure(taking.outcome.failure));
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
  lane: InputLane,
  live: Layer.Layer<HostNativeRead, never, R>,
): Layer.Layer<HostNativeRead, never, R> =>
  lane.kind === "recording"
    ? replaying(lane.store, lane.bindings)
    : lane.capture
      ? capturing(lane.capture).pipe(Layer.provide(live))
      : live;
