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
import { HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import type { DoorFailure } from "@pe/host-internal/request-contracts";
import { canonicalJson } from "../../../packages/host-internal/src/read-admission.ts";
import { BridgeError } from "@pe/host-internal/dispatch";
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

const failure = Schema.Struct({ tag: Schema.String, message: Schema.String });
const takingSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  at: Schema.Number,
  input: Schema.Struct({
    kind: Schema.Literal("native-read"),
    key: Schema.String,
    args: Schema.String,
  }),
  outputVersion: Schema.String,
  coverage: Schema.Literal("native-only"),
  outcome: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("answered"),
      observation: Schema.String,
      nativeRequestId: Schema.String,
      actualTarget: Schema.Struct({
        processIncarnation: Schema.Struct({ pid: Schema.Number, startedAt: Schema.Number }),
        openDocumentLifetime: Schema.Union([
          Schema.Struct({ openId: Schema.String }),
          Schema.Struct({ kind: Schema.Literal("session-only") }),
        ]),
      }),
      freshness: Schema.Struct({ freshnessGeneration: Schema.String }),
      cost: Schema.Struct({
        elements: Schema.optionalKey(Schema.Number),
        triangles: Schema.optionalKey(Schema.Number),
        bytes: Schema.optionalKey(Schema.Number),
        elapsed: Schema.optionalKey(Schema.Number),
      }),
      nativeOutcome: Schema.Literals([
        "never-dispatched",
        "native-cancel-requested",
        "native-acknowledged",
        "committed",
        "unknown-until-reconciled",
      ]),
    }),
    Schema.Struct({ kind: Schema.Literal("refused"), failure }),
    Schema.Struct({ kind: Schema.Literal("unknown"), failure }),
  ]),
});
export type Taking = typeof takingSchema.Type;
type TakingInput = Pick<Taking, "input" | "outputVersion">;
type Outcome =
  | {
      readonly kind: "answered";
      readonly value: Schema.Json;
      readonly answer: Omit<
        Extract<Taking["outcome"], { kind: "answered" }>,
        "kind" | "observation"
      >;
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
const io = <A>(problem: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => refuse(problem, String(error), 500) });
const missing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";
const observationSha = (outputVersion: string, bytes: string) =>
  createHash("sha256").update(`native-read\n${outputVersion}\n${bytes}`).digest("hex");
const identityOf = (key: string, args: string) => canonicalJson(["native-read", key, args]);

export interface RecordingStore {
  readonly identity: RecordingIdentity;
  readonly append: (input: TakingInput, outcome: Outcome) => Effect.Effect<Taking, InvalidRead>;
  /** Every taking of one input identity, oldest first; equal bytes never merge takings. */
  readonly candidates: (identity: string) => readonly Taking[];
  readonly taking: (id: string) => Taking | undefined;
  readonly observation: (taking: Taking) => Effect.Effect<Schema.Json, InvalidRead>;
}

/** Opens or creates one bundle. A different build or catalog, or a damaged line, refuses. */
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
  const existing = yield* io("io", () =>
    readFile(manifestPath, "utf8").catch((error: unknown) =>
      missing(error) ? null : Promise.reject(error),
    ),
  );
  if (existing === null) {
    yield* io("io", () => mkdir(observations, { recursive: true }));
    yield* io("io", () => writeFile(manifestPath, JSON.stringify(manifest)));
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
  const text = yield* io("io", () =>
    readFile(takingsPath, "utf8").catch((error: unknown) =>
      missing(error) ? "" : Promise.reject(error),
    ),
  );
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
      used += (yield* io("io", () => stat(join(observations, `${sha}.json`)))).size;
    }
  const clock = yield* Clock.Clock;
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
      const fresh = outcome.kind === "answered" && !stored.has(sha);
      const need = Buffer.byteLength(line) + (fresh ? Buffer.byteLength(bytes) : 0);
      // Reserved before any await, so concurrent takings cannot together pass the bound.
      if (takings.length + 1 > bounds.maxTakings || used + need > bounds.maxBytes)
        return yield* refuse(
          "full",
          `Recording is full (${used} of ${bounds.maxBytes} bytes, ${takings.length} of ${bounds.maxTakings} takings); this taking was not kept`,
          507,
        );
      used += need;
      takings.push(taking);
      if (fresh) {
        stored.add(sha);
        yield* io("io", () => writeFile(join(observations, `${sha}.json`), bytes, { flag: "wx" }));
      }
      yield* io("io", () => appendFile(takingsPath, line));
      return taking;
    }),
    candidates: (wanted: string) =>
      takings.filter((taking) => identityOf(taking.input.key, taking.input.args) === wanted),
    taking: (id: string) => takings.find((taking) => taking.id === id),
    observation: Effect.fn("Recording.observation")(function* (taking: Taking) {
      if (taking.outcome.kind !== "answered")
        return yield* refuse("miss", "This taking holds no observation");
      const sha = taking.outcome.observation;
      const bytes = yield* io("io", () => readFile(join(observations, `${sha}.json`), "utf8"));
      if (observationSha(taking.outputVersion, bytes) !== sha)
        return yield* refuse("tamper", `Observation ${sha} does not hash to its name`);
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(bytes).pipe(
        Effect.mapError(() => refuse("tamper", `Observation ${sha} is not JSON`)),
      );
    }),
  } satisfies RecordingStore;
});

/** Where native reads come from. `fixture` joins when a host fixture source exists. */
export type InputLane =
  | { readonly kind: "live"; readonly capture?: RecordingStore }
  | {
      readonly kind: "recording";
      readonly store: RecordingStore;
      /** Input identity to taking id; an explicit binding wins over candidate matching. */
      readonly bindings?: ReadonlyMap<string, string>;
    };

/** One native input's identity: its key and the canonical JSON of the request input. */
export const nativeInputIdentity = (request: NativeReadInput) =>
  argsOf(request).pipe(Effect.map((args) => identityOf(request.key, args)));
const argsOf = (request: NativeReadInput) =>
  Schema.decodeUnknownEffect(Schema.Json)(request.input).pipe(
    Effect.map(canonicalJson),
    Effect.mapError(() => refuse("input", "Native input is not JSON", 400)),
  );
const versionOf = (key: string) =>
  readSchemas(key).pipe(
    Effect.map((schemas) => schemas.version),
    Effect.orElseSucceed(() => "no-contract"),
  );
// A failure is a refusal only when nothing reached Revit; every other failure is an unknown outcome.
const refusedTags = new Set([
  "InvalidRequest",
  "Refused",
  "NoRevitSession",
  "ReadBusy",
  "ReadRetiring",
  "CommandRejected",
]);
const outcomeOf = (error: DoorFailure): Outcome => ({
  kind:
    refusedTags.has(error._tag) ||
    ("nativeOutcome" in error && error.nativeOutcome === "never-dispatched")
      ? "refused"
      : "unknown",
  failure: { tag: error._tag, message: error.message },
});

/** Live reads, captured into `store` when the lane asks; capture never alters what the caller gets. */
const capturing = (store: RecordingStore) =>
  Layer.effect(
    HostNativeRead,
    Effect.gen(function* () {
      const live = yield* HostNativeRead;
      return {
        resolve: live.resolve,
        read: (request) =>
          Effect.gen(function* () {
            const input = {
              kind: "native-read" as const,
              key: request.key,
              args: yield* argsOf(request),
            };
            const taking = { input, outputVersion: yield* versionOf(request.key) };
            const exit = yield* Effect.exit(live.read(request));
            if (Exit.isSuccess(exit)) {
              const { value, nativeRequestId, actualTarget, freshness, cost, outcome } = exit.value;
              yield* store.append(taking, {
                kind: "answered",
                value,
                answer: {
                  nativeRequestId,
                  actualTarget,
                  freshness: { freshnessGeneration: freshness.freshnessGeneration },
                  cost,
                  nativeOutcome: outcome,
                },
              });
              return exit.value;
            }
            const error = Cause.findErrorOption(exit.cause);
            // An interrupted caller has no outcome to record; its read is not a taking.
            if (Option.isSome(error)) yield* store.append(taking, outcomeOf(error.value));
            return yield* exit;
          }),
      };
    }),
  );

/** Recorded reads only: no live layer is built, and a miss is a typed refusal. */
const replaying = (store: RecordingStore, bindings: ReadonlyMap<string, string> = new Map()) => {
  const select = Effect.fn("Recording.select")(function* (request: NativeReadInput) {
    const args = yield* argsOf(request);
    const identity = identityOf(request.key, args);
    const bound = bindings.get(identity);
    const candidates =
      bound === undefined
        ? store.candidates(identity)
        : [store.taking(bound)].filter((t) => t !== undefined);
    if (candidates.length === 0)
      return yield* refuse(
        "miss",
        `The recording holds no taking of ${request.key} for this input`,
      );
    if (candidates.length > 1)
      return yield* refuse(
        "ambiguous",
        `The recording holds ${candidates.length} takings of ${request.key} for this input; bind one`,
      );
    const taking = candidates[0]!;
    if (taking.input.key !== request.key || taking.input.args !== args)
      return yield* refuse("mismatch", "The bound taking records a different input");
    if (taking.outputVersion !== (yield* versionOf(request.key)))
      return yield* refuse(
        "mismatch",
        `${request.key} changed its output contract since this recording`,
      );
    if (taking.outcome.kind !== "answered")
      return yield* Effect.fail(
        taking.outcome.kind === "refused"
          ? new BridgeError({
              message: `Recorded refusal (${taking.outcome.failure.tag}): ${taking.outcome.failure.message}`,
              status: 409,
              problem: "recording.refused",
              nativeOutcome: "never-dispatched",
            })
          : new BridgeError({
              message: `Recorded unknown outcome (${taking.outcome.failure.tag}): ${taking.outcome.failure.message}`,
              status: 504,
              problem: "recording.unknown",
              nativeOutcome: "unknown-until-reconciled",
            }),
      );
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
