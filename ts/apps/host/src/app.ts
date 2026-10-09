import { Deferred, Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { BRIDGE_PATH, hostProcessIdentity } from "@pe/host-contracts/contracts";
import type { PeaRuntimeCapabilities } from "@pe/mcps";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { getHostStatus } from "./local-ops.ts";
import { isSettingsSchemaUrl } from "./settings.ts";
import { isNavigation, opsCatalogRoute, type SpaFallback } from "./ops-catalog.ts";
import { demoRoutes } from "./demo-owner.ts";
import { callRoute } from "./call-route.ts";
import { docsRoute, sessionsRoute } from "./session-route.ts";
import {
  adminShutdownRoute,
  HostLifecycle,
  resolveHostVersion,
  ServiceFileLive,
} from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { staticSpaLayer } from "./static-spa.ts";
import { peRoutesLayer } from "./pe-routes.ts";
import { capturesRoute } from "./captures-route.ts";
import { pagesRoute } from "./pages-route.ts";
import { makeInstalledUpdateReader, updateRoutes } from "./update-route.ts";
import { UpdateReader } from "./update-reader.ts";

export { resolveWebRoot } from "./static-spa.ts";

const bridgeWsRoute = HttpRouter.add("GET", BRIDGE_PATH, (req) =>
  Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
);

// Live settings authoring schema, straight from the connected session. This is
// the $schema URL settings documents carry — IDE JSON LSPs fetch it on open.
// Never persisted: value-domain samples inside are derived from the open document.
const settingsSchemaRoute = HttpRouter.add("GET", "/schemas/settings/*", (req) =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const schemaUrl = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`).href;
    if (!isSettingsSchemaUrl(schemaUrl))
      return Response.jsonUnsafe({ error: `No schema at ${schemaUrl}` }, { status: 404 });
    const result = yield* Effect.result(
      bridge.invoke(
        "settings.schema",
        { schemaUrl },
        (yield* bridge.snapshot(undefined)).sessionId,
      ),
    );
    if (result._tag === "Failure")
      return Response.jsonUnsafe(
        { error: String(result.failure.message ?? result.failure) },
        { status: 503 },
      );
    const schemaJson = (result.success.value as { schemaJson?: string } | null)?.schemaJson;
    if (!schemaJson)
      return Response.jsonUnsafe({ error: `No schema at ${schemaUrl}` }, { status: 404 });
    return Response.text(schemaJson, {
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
    });
  }),
);

export const hostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const sessions = yield* bridge.list;
    return yield* Response.json(
      yield* getHostStatus({ connected: sessions.some((session) => session.connected) }),
    );
  }),
);

const noRevitHostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.flatMap(getHostStatus({ connected: false }, { revit: false }), Response.json),
);

const emptyNotFound = Effect.succeed(Response.empty({ status: 404 }));

const bridgeEventsRoute = HttpRouter.add("GET", "/events", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const encoder = new TextEncoder();
    const body = Stream.make(encoder.encode(": open\n\n")).pipe(
      Stream.concat(
        Stream.fromPubSub(bridge.events).pipe(
          Stream.map((event) =>
            encoder.encode(`data: ${JSON.stringify({ ...event, atMs: Date.now() })}\n\n`),
          ),
        ),
      ),
    );
    return Response.stream(body, {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    });
  }),
);

const noRevitBoundary = () =>
  Layer.mergeAll(
    HttpRouter.add("*", BRIDGE_PATH, emptyNotFound),
    HttpRouter.add("*", "/sessions", emptyNotFound),
    HttpRouter.add("*", "/events", emptyNotFound),
    HttpRouter.add("*", "/schemas/settings/*", emptyNotFound),
    HttpRouter.add("*", "/host/install", emptyNotFound),
  );

// Installed-version readout for the web release chip. The installed layout is fixed (no receipt,
// no pointer), so the only truth about "which release is this" is the version baked into this
// bundle at pack time.
const hostInstallRoute = HttpRouter.add("GET", "/host/install", () =>
  Effect.sync(() => {
    const installed = hostOwnership.lane === "installed";
    return Response.jsonUnsafe({
      installed,
      releaseVersion: installed ? resolveHostVersion() : null,
    });
  }),
);

function makeRevitComposition(spa: SpaFallback = () => emptyNotFound) {
  return {
    provider: RevitBridgeLive,
    routes: Layer.mergeAll(
      bridgeWsRoute,
      bridgeEventsRoute,
      opsCatalogRoute(spa),
      settingsSchemaRoute,
      hostStatusRoute,
      hostInstallRoute,
      sessionsRoute,
      docsRoute,
      callRoute,
    ),
  };
}

export interface HttpLiveOptions {
  /** Preferred listen port (0 = ephemeral, used by the boundary test). */
  readonly port: number;
  readonly capabilities: PeaRuntimeCapabilities;
  /** Injected listener for socket lifecycle tests. */
  readonly nodeServer?: Server;
  /** Browser origin of the separately owned dev frontend. API requests stay here. */
  readonly webUrl?: Deferred.Deferred<string>;
  /** Boot-scoped shutdown latch + service token, injected by the launch root. */
  readonly lifecycle: HostLifecycle["Service"];
  readonly updateReader?: UpdateReader["Service"];
  /** Built SPA directory, or null to skip static serving (dev/vite). */
  readonly webRoot: string | null;
  /** Route registrations for the host-owned route surface; tests inject their own. */
  readonly routeRegistrations?: Parameters<typeof peRoutesLayer>[0];
  /** Test sentinel for the complete Revit/SDK/proxy composition. */
  readonly revitCompositionFactory?: typeof makeRevitComposition;
}

/**
 * Assemble the full host app + server as one launchable Layer. `port` is a parameter so the
 * boundary test can boot the real composition on an ephemeral port. HttpServer is provided once
 * (via `NodeHttpServer.layer`) and shared by the router and the service-file writer.
 */
export function makeHttpLive(options: HttpLiveOptions) {
  const UpdateLive = Layer.succeed(
    UpdateReader,
    options.updateReader ?? makeInstalledUpdateReader(),
  );
  const nodeServer = options.nodeServer ?? createServer();
  // Socket retirement. The platform layer detaches its request handler and calls `server.close`
  // on release, but a keep-alive socket a browser still holds survives that close with nothing
  // listening behind it; a reload against a successor on the same port then reuses the dead
  // socket and waits forever (a dev-host takeover has the same shape). This finalizer is a
  // dependency of the server layer, so it runs AFTER the platform release and closes every
  // remaining connection: a retired host holds no socket a client can reuse.
  const RetireSocketsLive = Layer.effectDiscard(
    Effect.addFinalizer(() =>
      Effect.sync(() => {
        nodeServer.closeIdleConnections();
        nodeServer.closeAllConnections();
      }),
    ),
  );
  const ServerLive = NodeHttpServer.layer(() => nodeServer, {
    host: "127.0.0.1",
    port: options.port,
  }).pipe(Layer.provide(RetireSocketsLive));
  const ClaimedServerLive = Layer.mergeAll(
    ServerLive,
    ServiceFileLive.pipe(Layer.provide(ServerLive)),
  );

  const webUrl = options.webUrl;
  const webRoot = options.webRoot;
  const spa: SpaFallback = webUrl
    ? (req) => Effect.map(Deferred.await(webUrl), (url) => Response.redirect(url + req.originalUrl))
    : webRoot
      ? () => Effect.sync(() => Response.html(readFileSync(join(webRoot, "index.html"), "utf8")))
      : () => emptyNotFound;
  const CommonAppLive = Layer.mergeAll(
    capturesRoute(spa),
    pagesRoute(),
    adminShutdownRoute,
    updateRoutes,
    peRoutesLayer(options.routeRegistrations),
    demoRoutes(),
    webUrl
      ? HttpRouter.add("GET", "/*", (req) => (isNavigation(req) ? spa(req) : emptyNotFound))
      : staticSpaLayer(options.webRoot),
  );

  if (options.capabilities.revit) {
    const revitComposition = (options.revitCompositionFactory ?? makeRevitComposition)(spa);
    return HttpRouter.serve(Layer.mergeAll(revitComposition.routes, CommonAppLive)).pipe(
      Layer.provide(ClaimedServerLive),
      Layer.provide(NodeHttpClient.layerUndici),
      Layer.provide(revitComposition.provider),
      Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
      Layer.provide(UpdateLive),
      Layer.provide(NodeServices.layer),
    );
  }

  return HttpRouter.serve(
    Layer.mergeAll(
      noRevitBoundary(),
      callRoute,
      opsCatalogRoute(spa),
      noRevitHostStatusRoute,
      CommonAppLive,
    ),
  ).pipe(
    // The empty in-memory bridge registry admits no native connection on this composition.
    Layer.provide(RevitBridgeLive),
    Layer.provide(ClaimedServerLive),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(UpdateLive),
    Layer.provide(NodeServices.layer),
  );
}
