import { nativeOutputSchema } from "@pe/agent-contracts";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import { CurrentInputConsumption, inputIdentity } from "@pe/host-internal/input-occurrence";
import {
  captured,
  chooseTaking,
  failedOutcome,
  recordedNativeArgs,
  recordedNativeJson,
  refuse,
  replayFailure,
  selectedFor,
  unobserved,
  type HostInputLane,
  type Occurrence,
  type Outcome,
  type RecordingReader,
  type RecordingWriter,
  type TakingObserver,
} from "@pe/host-internal/input-recording";
import { HostNativeRead, type NativeReadInput } from "@pe/host-internal/native-read";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { admitNativeCaller } from "./native-read-policy.ts";
import { readSchemas } from "./request-services.ts";

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
          captured(
            store,
            request.key,
            live.read(request),
            (exit) =>
              Effect.gen(function* () {
                const outcome: Outcome | null = Exit.isSuccess(exit)
                  ? {
                      kind: "answered",
                      value: exit.value.value,
                      answer: {
                        nativeRequestId: exit.value.nativeRequestId,
                        actualTarget: exit.value.actualTarget,
                        freshness: {
                          freshnessGeneration: exit.value.freshness.freshnessGeneration,
                        },
                        cost: exit.value.cost,
                        nativeOutcome: exit.value.outcome,
                      },
                    }
                  : yield* failedOutcome(exit);
                if (outcome === null) return null;
                const input = {
                  input: {
                    kind: "native" as const,
                    key: request.key,
                    args: yield* recordedNativeArgs(request),
                  },
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
    Effect.map(([args, scope]) => ({
      input: { kind: "native" as const, key: request.key, args },
      scope,
    })),
    Effect.orElseSucceed(() => undefined),
  );

/** Recorded reads only: no live layer is built, and a miss is a typed refusal. */
const replaying = (store: RecordingReader, bindings: ReadonlyMap<string, string> = new Map()) => {
  // `consume` is a read; resolve validates the descriptor and reserves no occurrence.
  const select = Effect.fn("Recording.select")(function* (
    request: NativeReadInput,
    consume: boolean,
  ) {
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
          try: () =>
            Schema.decodeUnknownSync(Schema.Json)(
              nativeOutputSchema(request.key as HostOperationKey).parse(raw),
            ),
          catch: () =>
            refuse("mismatch", `Recorded ${request.key} no longer satisfies its contract`),
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
