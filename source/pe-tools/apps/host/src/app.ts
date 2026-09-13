import { Deferred, Effect, Layer, Stream } from "effect";
import {
  HttpRouter,
  HttpServer,
  type HttpServerRequest,
  HttpServerResponse as Response,
} from "effect/unstable/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { BRIDGE_PATH, hostProcessIdentity } from "@pe/host-contracts/contracts";
import type { PeaRuntimeCapabilities } from "@pe/runtime/pea";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { getHostStatus } from "./local-ops.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  tsOnlyOperationCatalog,
} from "@pe/host-contracts/operation-types";
import { callRoute } from "./call-route.ts";
import { productRoot } from "./host-ownership.ts";
import { docsRoute, sessionsRoute } from "./session-route.ts";
import {
  adminShutdownRoute,
  announceServedSession,
  HostLifecycle,
  resolveHostVersion,
  ServiceFileLive,
} from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { MastraMountLive, MastraRuntime, withMastraDegrade } from "./mastra-runtime.ts";
import { staticSpaLayer } from "./static-spa.ts";

export { resolveWebRoot } from "./static-spa.ts";

const bridgeWsRoute = HttpRouter.add("GET", BRIDGE_PATH, (req) =>
  Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
);

// Runtime operation catalog for browsers/typegen: proxies host.ops.catalog to the
// connected Revit session (the standard selector header targets one; ?session is the raw query form)
// op keys + request/response JSON Schemas as plain JSON. The host-local (TS-only) ops
// are appended so discovery (host_operation_search, pea `operations`, the web ops page)
// sees both surfaces from one catalog; host-typegen skips them by their origin marker.
// A disconnected bridge still lists the local ops (they need no Revit session) with a
// bridgeCatalogError note, rather than a bare 503 — so discovery of e.g. settings workspaces
// works with the host up and Revit closed. (host-typegen treats a bridge-op-less catalog
// as "no session" and does not regenerate off the local ops alone.)
/** A browser navigation (Accept: text/html) to an API path belongs to the SPA, not the JSON. */
type SpaFallback = (
  req: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<Response.HttpServerResponse, unknown, never>;
const isNavigation = (req: HttpServerRequest.HttpServerRequest) =>
  (req.headers.accept ?? "").includes("text/html");

const opsCatalogRoute = (spa: SpaFallback) =>
  HttpRouter.add("GET", "/ops", (req) =>
    Effect.gen(function* () {
      if (isNavigation(req)) return yield* spa(req);
      const bridge = yield* RevitBridge;
      const sessionParam =
        new URL(req.url, "http://localhost").searchParams.get("session") ?? undefined;
      const sessionHeader = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim() || undefined;
      if (sessionParam && sessionHeader && sessionParam !== sessionHeader)
        return Response.jsonUnsafe(
          { error: "Conflicting bridge session selectors in header and query." },
          { status: 400 },
        );
      // Catalog reads never hard-fail on multi-session ambiguity: untargeted falls back to the
      // snapshot session (most recently registered), same as other status displays.
      const readSessionId =
        sessionHeader ?? sessionParam ?? (yield* bridge.snapshot(undefined)).sessionId;
      const result = yield* Effect.result(bridge.invoke("host.ops.catalog", {}, readSessionId));
      const bridgeOps =
        result._tag === "Success" &&
        Array.isArray((result.success as { operations?: unknown }).operations)
          ? (result.success as { operations: unknown[] }).operations
          : [];
      const body: {
        operations: unknown[];
        bridgeSessionId?: string;
        bridgeCatalogError?: string;
      } = {
        operations: [...bridgeOps, ...tsOnlyOperationCatalog],
        bridgeSessionId: readSessionId,
      };
      if (result._tag === "Failure")
        body.bridgeCatalogError = String(result.failure.message ?? result.failure);
      return Response.jsonUnsafe(body);
    }),
  );

// Live settings authoring schema, straight from the connected session. This is
// the $schema URL settings documents carry — IDE JSON LSPs fetch it on open.
// Never persisted: value-domain samples inside are derived from the open document.
const settingsSchemaRoute = HttpRouter.add(
  "GET",
  "/schemas/settings/:moduleKey/:rootKey",
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const params = yield* HttpRouter.params;
    const moduleKey = decodeURIComponent(params.moduleKey ?? "");
    const rootKey = decodeURIComponent(params.rootKey ?? "").replace(/\.json$/i, "");
    const result = yield* Effect.result(
      bridge.invoke(
        "settings.schema",
        { moduleKey, rootKey },
        (yield* bridge.snapshot(undefined)).sessionId,
      ),
    );
    if (result._tag === "Failure")
      return Response.jsonUnsafe(
        { error: String(result.failure.message ?? result.failure) },
        { status: 503 },
      );
    const schemaJson = (result.success as { schemaJson?: string } | null)?.schemaJson;
    if (!schemaJson)
      return Response.jsonUnsafe(
        { error: `No schema for ${moduleKey}/${rootKey}` },
        { status: 404 },
      );
    return Response.text(schemaJson, {
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
    });
  }),
);

const hostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const snapshot = yield* bridge.snapshot(undefined);
    return yield* Response.json(yield* getHostStatus(snapshot));
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

export const noRevitBoundary = (spa: SpaFallback) =>
  Layer.mergeAll(
    HttpRouter.add("*", BRIDGE_PATH, emptyNotFound),
    HttpRouter.add("*", "/call", emptyNotFound),
    HttpRouter.add("*", "/ops", (req) => (isNavigation(req) ? spa(req) : emptyNotFound)),
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

/**
 * Service-file schema 3, second half: once a Revit payload registers on the bridge and reports the
 * pe-revit session it belongs to, amend this host's service file to name that session. That is what
 * turns `session list`'s companion observation from a lane guess into a real association — the SDK reads
 * the file, and the file now says which session this host serves.
 *
 * A host serves at most one Revit session in practice, but nothing enforces it; the LAST session to
 * connect wins, which is the same "current session" rule the rest of this broker already uses.
 * Best-effort by construction: the announcement never gates registration.
 */
const ServedSessionLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const { handle: handleDeferred } = yield* HostLifecycle;
    yield* Effect.forkScoped(
      Stream.fromPubSub(bridge.events).pipe(
        Stream.filter((event) => event.kind === "connected"),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const views = yield* bridge.list;
            const sdkSessionId = views.find(
              (view) => view.sessionId === event.sessionId,
            )?.sdkSessionId;
            // No sdkSessionId means this Revit was not launched by pe-revit (custody `observed`);
            // there is no session to name, and claiming one would be an invention.
            if (!sdkSessionId) return;
            const handle = yield* Deferred.await(handleDeferred);
            yield* Effect.promise(() => announceServedSession(productRoot(), handle, sdkSessionId));
          }),
        ),
      ),
    );
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
      ServedSessionLive,
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
  /**
   * The Mastra tenant layer; the boundary test swaps a trivial stub (RIn = never) for the real
   * runtime (RIn = HttpServer). `HttpServer` is satisfied by the shared `NodeHttpServer.layer`.
   */
  readonly mastraLayer: Layer.Layer<MastraRuntime, unknown, HttpServer.HttpServer>;
  /** Boot-scoped shutdown latch + service token, injected by the launch root. */
  readonly lifecycle: HostLifecycle["Service"];
  /** Built SPA directory, or null to skip static serving (dev/vite). */
  readonly webRoot: string | null;
  /** Test sentinel for the complete Revit/SDK/proxy composition. */
  readonly revitCompositionFactory?: typeof makeRevitComposition;
}

/**
 * Assemble the full host app + server as one launchable Layer. `mastraLayer` and `port` are
 * parameters so the boundary test can boot the real composition on an ephemeral port with a stub
 * tenant. HttpServer is provided once (via `NodeHttpServer.layer`) and shared by the router, the
 * Mastra tenant (bound loopback -> hostBaseUrl), and the service-file writer.
 */
export function makeHttpLive(options: HttpLiveOptions) {
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
    adminShutdownRoute,
    MastraMountLive,
    webUrl
      ? HttpRouter.add("GET", "/*", (req) => (isNavigation(req) ? spa(req) : emptyNotFound))
      : staticSpaLayer(options.webRoot),
  );

  if (options.capabilities.revit) {
    const revitComposition = (options.revitCompositionFactory ?? makeRevitComposition)(spa);
    return HttpRouter.serve(Layer.mergeAll(revitComposition.routes, CommonAppLive)).pipe(
      Layer.provide(withMastraDegrade(options.mastraLayer)),
      Layer.provide(ClaimedServerLive),
      Layer.provide(NodeHttpClient.layerUndici),
      Layer.provide(revitComposition.provider),
      Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
      Layer.provide(NodeServices.layer),
    );
  }

  return HttpRouter.serve(
    Layer.mergeAll(noRevitBoundary(spa), noRevitHostStatusRoute, CommonAppLive),
  ).pipe(
    // ClaimedServerLive binds and completes takeover before the tenant opens shared product state.
    // The tenant still receives that same HttpServer, and any runtime failure degrades only /pe/*.
    Layer.provide(withMastraDegrade(options.mastraLayer)),
    Layer.provide(ClaimedServerLive),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(NodeServices.layer),
  );
}
