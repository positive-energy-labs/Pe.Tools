import { randomUUID } from "node:crypto";
import { Context, Deferred, Effect, Exit, Layer, Schema } from "effect";
import type { DoorFailure, NativeAnswer, PreparedRead } from "@pe/host-internal/request-contracts";
import {
  canonicalJson,
  decodePreparedRead,
} from "../../../packages/host-internal/src/read-admission.ts";
import { RevitBridge, CANCEL_OPERATION_KEY } from "./bridge.ts";

const fields = { message: Schema.String, status: Schema.Number, problem: Schema.String };
export class ReadBusy extends Schema.TaggedError<ReadBusy>()("ReadBusy", fields) {}
export class ReadRetiring extends Schema.TaggedError<ReadRetiring>()("ReadRetiring", fields) {}
export class InvalidRead extends Schema.TaggedError<InvalidRead>()("InvalidRequest", fields) {}

export const NativeReadLimits = Context.Reference<{
  entries: number;
  joiners: number;
  keyBytes: number;
  resultBytes: number;
}>("NativeReadLimits", {
  defaultValue: () => ({
    entries: 64,
    joiners: 256,
    keyBytes: 1024 * 1024,
    resultBytes: 32 * 1024 * 1024,
  }),
});

type Flight = {
  readonly requestId: string;
  readonly ready: Deferred.Deferred<boolean>;
  readonly settled: Deferred.Deferred<void>;
  readonly answer: Deferred.Deferred<NativeAnswer<unknown>, DoorFailure>;
  callers: number;
  retiring: boolean;
  terminal: boolean;
};

export class NativeReads extends Context.Service<
  NativeReads,
  {
    readonly join: <A>(
      read: PreparedRead<A>,
      session: string,
    ) => Effect.Effect<NativeAnswer<A>, DoorFailure>;
    readonly retained: Effect.Effect<{ entries: number; joiners: number }>;
  }
>()("NativeReads") {
  static readonly layer = Layer.effect(
    NativeReads,
    Effect.gen(function* () {
      const bridge = yield* RevitBridge;
      const scope = yield* Effect.scope;
      const limits = yield* NativeReadLimits;
      if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
        return yield* Effect.die(new Error("Native read bounds must be positive safe integers"));
      const flights = new Map<string, Flight>();
      yield* Effect.addFinalizer(() => Effect.sync(() => flights.clear()));
      const busy = (message: string) =>
        new ReadBusy({ message, status: 429, problem: "read.capacity" });
      const join = Effect.fn("NativeReads.join")(function* <A>(
        read: PreparedRead<A>,
        session: string,
      ) {
        const descriptor = read.descriptor;
        const identity = canonicalJson(Schema.decodeUnknownSync(Schema.Json)(descriptor));
        if (Buffer.byteLength(identity) > limits.keyBytes)
          return yield* busy("Native read identity exceeds its byte bound");
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            let flight = flights.get(identity);
            if (flight?.retiring)
              return yield* new ReadRetiring({
                message: "Native read is retiring; retry after terminal settlement",
                status: 409,
                problem: "read.retiring",
              });
            if (!flight) {
              if (flights.size >= limits.entries)
                return yield* busy("Native read capacity reached");
              const created: Flight = {
                requestId: randomUUID(),
                ready: yield* Deferred.make<boolean>(),
                settled: yield* Deferred.make<void>(),
                answer: yield* Deferred.make<NativeAnswer<unknown>, DoorFailure>(),
                callers: 0,
                retiring: false,
                terminal: false,
              };
              flights.set(identity, created);
              flight = created;
              const openId =
                "openId" in descriptor.openDocumentLifetime
                  ? descriptor.openDocumentLifetime.openId
                  : null;
              const dispatch = Effect.gen(function* () {
                const acquired = yield* Effect.exit(
                  bridge.invokeHandle(
                    descriptor.operationKey,
                    JSON.parse(descriptor.normalizedInput),
                    session,
                    openId,
                    created.requestId,
                  ),
                );
                if (Exit.isFailure(acquired)) {
                  yield* Deferred.succeed(created.ready, false);
                  yield* Deferred.failCause(created.answer, acquired.cause);
                  flights.delete(identity);
                  return;
                }
                const handle = acquired.value;
                yield* Deferred.succeed(created.ready, true);
                yield* Effect.logInfo(
                  `Native read queued op=${descriptor.operationKey} request=${created.requestId}`,
                );
                // Observe the answer separately: an unknown answer does NOT settle the native work.
                yield* handle.answer.pipe(
                  Effect.flatMap((answer) =>
                    Effect.gen(function* () {
                      if (
                        canonicalJson(answer.actualTarget) !==
                        canonicalJson({
                          processIncarnation: descriptor.processIncarnation,
                          openDocumentLifetime: descriptor.openDocumentLifetime,
                        })
                      )
                        return yield* new InvalidRead({
                          message: "Native read target changed after admission",
                          status: 409,
                          problem: "read.target",
                        });
                      const json = yield* Schema.decodeUnknownEffect(Schema.Json)(
                        answer.value,
                      ).pipe(
                        Effect.mapError(
                          () =>
                            new InvalidRead({
                              message: "Native answer is not JSON",
                              status: 502,
                              problem: "read.response",
                            }),
                        ),
                      );
                      if (Buffer.byteLength(JSON.stringify(json)) > limits.resultBytes)
                        return yield* busy("Native read result exceeds its byte bound");
                      return {
                        ...answer,
                        freshness: { freshnessGeneration: descriptor.freshnessGeneration },
                      };
                    }),
                  ),
                  Effect.exit,
                  Effect.flatMap((exit) => Deferred.done(created.answer, exit)),
                  Effect.forkIn(scope),
                );
                const outcome = yield* handle.terminal;
                created.terminal = true;
                flights.delete(identity);
                yield* Deferred.succeed(created.settled, undefined);
                yield* Effect.logInfo(
                  `Native read terminal op=${descriptor.operationKey} request=${created.requestId} outcome=${outcome}`,
                );
              });
              yield* dispatch.pipe(Effect.forkIn(scope));
            }
            const joined = flight;
            if (joined.callers >= limits.joiners)
              return yield* busy("Native read joiner capacity reached");
            joined.callers++;
            return yield* restore(
              Effect.logInfo(
                `Native read joined op=${descriptor.operationKey} request=${joined.requestId} callers=${joined.callers}`,
              ).pipe(Effect.andThen(Deferred.await(joined.answer))),
            ).pipe(
              Effect.flatMap((answer) =>
                decodePreparedRead(read, answer.value).pipe(
                  Effect.mapError(
                    () =>
                      new InvalidRead({
                        message: "Native response violates its operation Schema",
                        status: 502,
                        problem: "read.response",
                      }),
                  ),
                  Effect.map((value) => ({ ...answer, value })),
                ),
              ),
              Effect.onExit((exit) =>
                Effect.gen(function* () {
                  joined.callers--;
                  if (joined.callers !== 0 || joined.terminal || joined.retiring) return;
                  // Unknown failures also leave no consumer; keep the identity fenced until terminal.
                  if (!Exit.isFailure(exit)) return;
                  joined.retiring = true;
                  yield* Deferred.await(joined.ready).pipe(
                    Effect.flatMap((acquired) =>
                      acquired && !joined.terminal
                        ? bridge
                            .invoke(CANCEL_OPERATION_KEY, { requestId: joined.requestId }, session)
                            .pipe(
                              Effect.tap(() =>
                                Effect.logInfo(
                                  `Native read cancel requested op=${descriptor.operationKey} request=${joined.requestId}`,
                                ),
                              ),
                              Effect.catch(() =>
                                Effect.logWarning(
                                  `Native read cancel unconfirmed op=${descriptor.operationKey} request=${joined.requestId}; retaining until terminal`,
                                ),
                              ),
                              // The original terminal also retires a lost cancel acknowledgement.
                              // Otherwise completed flights could leave unbounded cancel waiters.
                              Effect.raceFirst(Deferred.await(joined.settled)),
                            )
                        : Effect.void,
                    ),
                    Effect.forkIn(scope),
                  );
                }),
              ),
            );
          }),
        );
      });
      return {
        join,
        retained: Effect.sync(() => ({
          entries: flights.size,
          joiners: [...flights.values()].reduce((n, f) => n + f.callers, 0),
        })),
      };
    }),
  );
}
