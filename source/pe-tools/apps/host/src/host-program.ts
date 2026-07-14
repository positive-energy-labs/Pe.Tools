import { randomUUID } from "node:crypto";
import { Deferred, Effect, Layer } from "effect";
import { HOST_PORT, prepareHostOwnership } from "./host-ownership.ts";
import { makeHttpLive, MastraRuntimeLive, resolveWebRoot } from "./app.ts";

/** The shared host lifecycle used by both installed startup and source web development. */
export const hostProgram = <A, E, R>(beforeHost: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* prepareHostOwnership();
      yield* beforeHost;

      const latch = yield* Deferred.make<void>();
      const serviceToken = randomUUID();
      const HttpLive = makeHttpLive({
        port: HOST_PORT,
        mastraLayer: MastraRuntimeLive,
        lifecycle: { latch, serviceToken },
        webRoot: resolveWebRoot(),
      });

      yield* Effect.forkDetach(
        Deferred.await(latch).pipe(
          Effect.andThen(Effect.sync(() => setTimeout(() => process.exit(0), 5_000).unref())),
        ),
      );

      yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
    }),
  );
