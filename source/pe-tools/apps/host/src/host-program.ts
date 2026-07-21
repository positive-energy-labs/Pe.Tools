import { Deferred, Effect, Layer } from "effect";
import type { Server } from "node:http";
import type { ViteDevServer } from "vite-plus";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { chooseServicePort } from "@pe/host-contracts/pe-service-host";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { productRoot } from "@pe/host-contracts/service-identity";
import { makeHttpLive, MastraRuntimeLive, resolveWebRoot } from "./app.ts";
import { hostOwnership } from "./host-ownership.ts";

const preferredPort = Number(new URL(hostProcessIdentity.defaultHostBaseUrl).port);

/** The shared host lifecycle used by both installed startup and source web development. */
export const hostProgram = <A, E, R>(options: {
  readonly beforeHost: Effect.Effect<A, E, R>;
  readonly nodeServer?: Server;
  readonly viteServer?: ViteDevServer;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* options.beforeHost;
      const port = yield* Effect.promise(() =>
        chooseServicePort(productRoot(), hostOwnership.serviceName, preferredPort),
      );

      // The service-file identity + eviction is SDK-owned (D3): ServiceFileLive claims it on bind and
      // publishes the claim handle here. No pre-bind takeover, no locally minted token.
      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const HttpLive = makeHttpLive({
        port,
        nodeServer: options.nodeServer,
        viteServer: options.viteServer,
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
      console.log(`pe-host binding http://127.0.0.1:${port || "dynamic"}`);
      yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
    }),
  );
