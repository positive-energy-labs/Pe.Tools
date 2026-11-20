import {
  FORMAT, sha256Name, readSetIdName, recordedNativeJson, recordedNativeArgs, selectedFor, takingSchema, readSetRecordSchema, unobserved, refuse, chooseTaking, replayFailure, captured, failedOutcome,
  type RecordingIdentity, type RecordingReader, type RecordingWriter, type HostInputLane,
  type Occurrence, type Taking, type TakingObserver, type TakingInput, type InputReadSetRecord, type Outcome,
} from "@pe/host-internal/input-recording";
import { writeArtifact } from "./page-artifacts.ts";
/**
 * Host input recording (ADR 0031 rules 1, 2 and 5). One bundle of takings answers the host's input
 * services: native reads through `HostNativeRead`, and every other owner (files, marks, inventory,
 * Work) through `captureInput`/`replayInput` with that owner's codec. A miss refuses and never
 * reaches a live input. Coverage is only the kinds a bundle durably holds, never a whole document.
 */
import { randomUUID, createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeState, stateKind, type StateDirectory } from "@pe/host-contracts/kinds";
import { z } from "zod";
const recordingMetadataKind = stateKind({
  schema: z.unknown(),
  place: (_folder: string, _id: string) => "Recording metadata",
  segments: (folder: string,
  id: string) => [folder, `${id}.json`],
});
import { Clock, Effect, Exit, Layer, Option, Schema } from "effect";
import { CurrentInputConsumption, inputIdentity } from "@pe/host-internal/input-occurrence";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { nativeOutputSchema } from "@pe/agent-contracts";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import { HostNativeRead, canonicalJson, type NativeReadInput } from "@pe/host-internal/native-read";
import { admitNativeCaller } from "./native-read-policy.ts";
import {
  truncationSchema,
  type InputKind,
} from "@pe/agent-contracts";
import type { InvalidRead } from "@pe/host-internal/read-errors";
import { readSchemas } from "./request-services.ts";
import {
  recordingPointSchema,
  recordingPointIdSchema,
  type RecordingPoint,
} from "@pe/agent-contracts";

export interface RecordingBounds {
  readonly maxBytes: number;
  readonly maxTakings: number;
}
/** The generated native catalog a bundle was recorded against; any contract change is a new bundle. */
export const nativeCatalogIdentity = () =>
  createHash("sha256").update(JSON.stringify(hostOpCatalog)).digest("hex");

const manifestSchema = Schema.Struct({
  version: Schema.Literal(FORMAT),
  build: Schema.String,
  catalog: Schema.String,
});
const TRUNCATION = "truncation.json";
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => refuse("io", String(error), 500) });
const missing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";
const observationSha = (kind: string, outputVersion: string, bytes: string) =>
  createHash("sha256").update(`${kind}\n${outputVersion}\n${bytes}`).digest("hex");
const READ_SETS = "read-sets";
const observationOf = (taking: Taking) =>
  taking.outcome.kind === "answered" || taking.outcome.kind === "observed"
    ? taking.outcome.observation
    : null;

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
  // A crash between the blob and taking append must not recover uncharged disk capacity.
  for (const name of yield* io(() => readdir(observations).catch((error: unknown) => missing(error) ? [] : Promise.reject(error)))) {
    const sha = yield* Schema.decodeUnknownEffect(sha256Name)(name.endsWith(".json") ? name.slice(0, -5) : null)
      .pipe(Effect.mapError(() => refuse("tamper", "Observation filename is not a SHA-256")));
    if (!stored.has(sha)) used += (yield* io(() => stat(join(observations, name)))).size;
  }
  const names = yield* io(() =>
    readdir(join(dir, READ_SETS)).catch((error: unknown) => (missing(error) ? [] : Promise.reject(error))),
  );
  const sets: string[] = [];
  for (const name of names) {
    // A crashed atomic save may leave its uncommitted temp; charge its bytes, never publish it.
    const pending = name.endsWith(".json.tmp");
    const suffix = pending ? ".json.tmp" : ".json";
    const id = yield* Schema.decodeUnknownEffect(readSetIdName)(
      name.endsWith(suffix) ? name.slice(0, -suffix.length) : null,
    ).pipe(Effect.mapError(() => refuse("tamper", `Read-set filename ${name} is not host minted`)));
    used += (yield* io(() => stat(join(dir, READ_SETS, name)))).size;
    if (!pending) sets.push(id);
  }
  const pointNames = yield* io(() =>
    readdir(join(dir, "points")).catch((error: unknown) =>
      missing(error) ? [] : Promise.reject(error),
    ),
  );
  if (pointNames.length > bounds.maxTakings)
    return yield* refuse("full", "Recording has too many point metadata files", 507);
  const points: string[] = [];
  for (const name of pointNames) {
    const pending = name.endsWith(".json.tmp");
    const suffix = pending ? ".json.tmp" : ".json";
    const id = yield* Schema.decodeUnknownEffect(recordingPointIdSchema)(
      name.endsWith(suffix) ? name.slice(0, -suffix.length) : null,
    ).pipe(Effect.mapError(() => refuse("tamper", "Point filename is not host minted")));
    used += (yield* io(() => stat(join(dir, "points", name)))).size;
    if (!pending) points.push(id);
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
    takingCursor: () => takings.length,
    takingAt: (cursor) => takings[cursor],
    points: {
      ids: () => points.slice(),
      get: Effect.fn("Recording.point")(function* (id: string) {
        const name = yield* Schema.decodeUnknownEffect(recordingPointIdSchema)(id).pipe(
          Effect.mapError(() => refuse("point", "Point id is not host minted")),
        );
        const text = yield* bounded(join(dir, "points", `${name}.json`), null);
        if (text === null) return yield* refuse("point", "No such recording point");
        const point = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(recordingPointSchema),
        )(text).pipe(Effect.mapError(() => refuse("tamper", "Point metadata is damaged")));
        if (
          point.id !== name ||
          point.identity.build !== identity.build ||
          point.identity.catalog !== identity.catalog
        )
          return yield* refuse("mismatch", "Point belongs to another build, catalog or name");
        return point;
      }),
    },
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
    coverage: () => [...new Set(takings.flatMap((taking) => taking.input.kind === "publication" ? [] : [taking.input.kind]))],
    truncation,
    readSets: {
      ids: () => sets.slice(),
      get: Effect.fn("Recording.readSet")(function* (id: string) {
        const name = yield* Schema.decodeUnknownEffect(readSetIdName)(id).pipe(
          Effect.mapError(() => refuse("context", "Read-set id is not host minted")),
        );
        const text = yield* bounded(join(dir, READ_SETS, `${name}.json`), null);
        if (text === null) return yield* refuse("context", `No read set ${name} in this recording`);
        const record = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(readSetRecordSchema))(
          text,
        ).pipe(Effect.mapError(() => refuse("tamper", `Read set ${name} is damaged or retired; record it again. Recording bytes were not changed.`)));
        if (record.id !== name || record.identity.build !== identity.build || record.identity.catalog !== identity.catalog)
          return yield* refuse("mismatch", `Read set ${name} belongs to another build or name`);
        const seen = new Set<string>();
        for (const entry of record.inputs) {
          const occurrence = canonicalJson([inputIdentity(entry.input), entry.scope, entry.start]);
          if (seen.has(occurrence))
            return yield* refuse("ambiguous", `Read set ${name} names one input occurrence twice`);
          seen.add(occurrence);
          const taking = takings.find((candidate) => candidate.id === entry.takingId);
          if (!taking || inputIdentity(taking.input) !== inputIdentity(entry.input) || taking.scope !== entry.scope)
            return yield* refuse("mismatch", `Read set ${name} links a taking of another input`);
        }
        for (const takingId of Object.values(record.takingLinks))
          if (!takings.some((candidate) => candidate.id === takingId))
            return yield* refuse("miss", `Read set ${name} links a missing taking`);
        return record;
      }),
    },
  };
  return { reader, takings, stored, sets, points, used, takingsPath, observations };
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
  storage: StateDirectory,
  identity: RecordingIdentity,
  bounds: RecordingBounds,
) {
  const dir = storage.path;
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
  const pointWrites = new Set<string>();
  let reserved = 0;
  const clock = yield* Clock.Clock;
  const writeObservation = (sha: string, bytes: string) => {
    // An opened bundle losing its observations directory is damage, not a new store.
    const write = stat(observations)
      .then(() =>
        writeArtifact(observations, recordingMetadataKind.in(storage, "observations", sha), bytes),
      )
      .then(() => {
        stored.add(sha);
      })
      .finally(() => writing.delete(sha));
    writing.set(sha, write);
    return write;
  };
  const keepReadSet = Effect.fn("Recording.keepReadSet")(function* (record: InputReadSetRecord) {
    const bytes = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(readSetRecordSchema))(record).pipe(
      Effect.mapError(() => refuse("input", "Read-set metadata is not encodable", 400)),
    );
    if (record.identity.build !== identity.build || record.identity.catalog !== identity.catalog)
      return yield* refuse("mismatch", "Read-set metadata names another build");
    const size = Buffer.byteLength(bytes);
    if (used + size > bounds.maxBytes)
      return yield* refuse("full", `Recording is full; read set ${record.id} was not kept`, 507);
    used += size;
    const kept = yield* Effect.exit(
      io(async () => writeState(recordingMetadataKind.in(storage, READ_SETS, record.id), bytes)),
    );
    if (Exit.isFailure(kept)) {
      used -= size;
      return yield* Effect.failCause(kept.cause);
    }
    if (!loaded.sets.includes(record.id)) loaded.sets.push(record.id);
  });
  return {
    ...reader,
    points: {
      ...reader.points,
      keep: Effect.fn("Recording.keepPoint")(function* (point: RecordingPoint) {
        const bytes = yield* Schema.encodeUnknownEffect(
          Schema.fromJsonString(recordingPointSchema),
        )(point).pipe(
          Effect.mapError(() => refuse("input", "Point metadata is not encodable", 400)),
        );
        if (point.identity.build !== identity.build || point.identity.catalog !== identity.catalog)
          return yield* refuse("mismatch", "Point belongs to another build or catalog");
        const size = Buffer.byteLength(bytes);
        if (reader.points.ids().includes(point.id) || pointWrites.has(point.id))
          return yield* refuse("point", "Point already exists");
        if (used + size > bounds.maxBytes || reader.points.ids().length + pointWrites.size >= bounds.maxTakings)
          return yield* refuse("full", "Recording is full; point was not kept", 507);
        used += size;
        pointWrites.add(point.id);
        // Same reservation and atomic metadata durability as read sets. Failed IO remains charged.
        const kept = yield* Effect.exit(
          io(async () => writeState(recordingMetadataKind.in(storage, "points", point.id), bytes)),
        );
        pointWrites.delete(point.id);
        if (Exit.isFailure(kept)) return yield* Effect.failCause(kept.cause);
        loaded.points.push(point.id);
      }),
    },
    readSets: { ...reader.readSets, keep: keepReadSet },
    get truncation() {
      return truncated;
    },
    capture: {
      begin: () => (truncated ? null : ++attempts),
      truncated: () => truncated,
      stop: (at, reason, source) =>
        Effect.suspend(() => {
          if (truncated) return Effect.void;
          const op = truncationSchema.shape.op.safeParse(source.op);
          truncated = {
            at, stoppedAt: clock.currentTimeMillisUnsafe(),
            reason,
            site: source.site,
            op: op.success ? op.data : "unknown",
          };
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
          if (holds) await (writing.get(sha) ?? writeObservation(sha, bytes));
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

const scopeOf = (request: NativeReadInput) => recordedNativeJson(request.scope, "scope");
const versionOf = (key: string) =>
  readSchemas(key).pipe(
    Effect.map((schemas) => schemas.version),
    Effect.orElseSucceed(() => "no-contract"),
  );

/** Live reads, captured into `store` while its capture has not stopped. */
const capturing = (store: RecordingWriter, observed: TakingObserver) =>
  Layer.effect(
    HostNativeRead,
    Effect.gen(function* () {
      const live = yield* HostNativeRead;
      return {
        resolve: live.resolve,
        read: (request) =>
          captured(store, request.key, live.read(request), (exit) =>
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
                input: { kind: "native" as const, key: request.key, args: yield* recordedNativeArgs(request) },
                scope: yield* scopeOf(request),
                outputVersion: yield* versionOf(request.key),
              };
              return { input, outcome };
            }),
            observed,
            nativeOccurrence(request),
          ),
      };
    }),
  );
/** A native read's occurrence, when its input and scope are JSON; otherwise it has none to reserve. */
const nativeOccurrence = (request: NativeReadInput): Effect.Effect<Occurrence | undefined> =>
  Effect.all([recordedNativeArgs(request), scopeOf(request)]).pipe(
    Effect.map(([args, scope]) => ({ input: { kind: "native" as const, key: request.key, args }, scope })),
    Effect.orElseSucceed(() => undefined),
  );

/** Recorded reads only: no live layer is built, and a miss is a typed refusal. */
const replaying = (store: RecordingReader, bindings: ReadonlyMap<string, string> = new Map()) => {
  // `consume` is a read; resolve validates the descriptor and reserves no occurrence.
  const select = Effect.fn("Recording.select")(function* (request: NativeReadInput, consume: boolean) {
    yield* admitNativeCaller(request.key);
    const args = yield* recordedNativeArgs(request);
    const input = { kind: "native" as const, key: request.key, args };
    const identity = inputIdentity(input);
    const scope = yield* scopeOf(request);
    // A retained-call child names its original native acquisition: that exact link serves both
    // resolve and read (a cold hit-only child has no acquisition occurrence of its own).
    const consumption = yield* Effect.serviceOption(CurrentInputConsumption);
    const linked = Option.isSome(consumption)
      ? yield* Effect.option(consumption.value.taking("native"))
      : Option.none();
    const taking = yield* chooseTaking(
      store,
      identity,
      scope,
      request.key,
      Option.isSome(linked)
        ? linked.value
        : consume
          ? yield* selectedFor(input, scope, bindings.get(identity))
          : bindings.get(identity),
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
      select(request, false).pipe(
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
        const { taking, answer } = yield* select(request, true);
        const raw = yield* store.observation(taking);
        const value = yield* Effect.try({
          try:()=>Schema.decodeUnknownSync(Schema.Json)(nativeOutputSchema(request.key as HostOperationKey).parse(raw)),
          catch:()=>refuse("mismatch", `Recorded ${request.key} no longer satisfies its contract`),
        });
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
