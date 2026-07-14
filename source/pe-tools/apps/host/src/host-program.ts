import { Deferred, Effect, Layer } from "effect";
import { HOST_PORT } from "./host-ownership.ts";
import { makeHttpLive, MastraRuntimeLive, resolveWebRoot } from "./app.ts";
import type { ServiceHostHandle } from "./pe-service-host.ts";

/** The shared host lifecycle used by both installed startup and source web development. */
export const hostProgram = <A, E, R>(beforeHost: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* beforeHost;

      // The service-file identity + eviction is SDK-owned (D3): ServiceFileLive claims it on bind and
      // publishes the claim handle here. No pre-bind takeover, no locally minted token.
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const HttpLive = makeHttpLive({
        port: HOST_PORT,
        mastraLayer: MastraRuntimeLive,
        lifecycle: { latch, handle },
        webRoot: resolveWebRoot(),
      });

      yield* Effect.forkDetach(
        Deferred.await(latch).pipe(
          Effect.andThen(Effect.sync(() => setTimeout(() => process.exit(0), 5_000).unref())),
        ),
      );

      // Last pre-bind breadcrumb: the HTTP layer is about to launch. The bound "Listening on ..."
      // line follows once NodeHttpServer binds; a gap between these two in host.log localizes a hang
      // or crash to the layer build (e.g. bridge/service-claim/tenant) rather than earlier startup.
      console.log(`pe-host binding http://127.0.0.1:${HOST_PORT}`);
      yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
    }),
  );
