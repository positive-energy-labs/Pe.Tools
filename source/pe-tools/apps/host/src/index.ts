import { randomUUID } from "node:crypto";
import { Deferred, Effect, Layer } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { HOST_PORT, prepareHostOwnership } from "./host-ownership.ts";
import { makeHttpLive, MastraRuntimeLive, resolveWebRoot } from "./app.ts";

// Lifecycle root (Pillar 3): a Deferred latch raced against `Layer.launch` replaces the old
// `process.exit(0)`, so tearing down runs the launch scope's finalizers in reverse — graceful
// server close, Mastra release (session abort -> thread lock release -> controller destroy),
// service-file delete, then ownership-identity delete. `/admin/shutdown` (in the app) trips the
// latch after flushing its 200. A hard-exit timer arms once the latch fires as insurance against
// a stuck finalizer.
NodeRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      yield* prepareHostOwnership();

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
  ),
);
