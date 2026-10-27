import { currentMachine } from "./machine.ts";
import { sdkSession } from "./sdk-session.ts";
import { requestIdentityLayer } from "./request-identity.ts";
import { createDevices, type Devices } from "./remote-device.ts";
import { deviceRoutes } from "./device-routes.ts";
import { bindControl } from "./control.ts";
import { readRemoteIngress, remoteListener } from "./remote-ingress.ts";
import {
  createShare,
  shareIntentFile,
  shareRoute,
  tailscaleCommand,
  type ShareOwner,
} from "./share.ts";
import { mcpRoute } from "./mcp-route.ts";
import { Deferred, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { BRIDGE_PATH, hostProcessIdentity } from "@pe/host-contracts/contracts";
import { RouteWorkspace, type PeaRuntimeCapabilities } from "@pe/runtime";
import { createRouteRegistrations } from "@pe/mcps";
import { hostLoadedFamilies } from "../../../packages/mcps/src/pea/families-admission.ts";
import { fileRouteDocumentStore } from "./route-document-store.ts";
import { productRouteWorkPath } from "./product-paths.ts";
import { hostActionJournal, releaseHostReceipts } from "./gateway-owner.ts";
import { releaseHostReceiptExport } from "./receipt-export.ts";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { getHostStatus } from "./local-ops.ts";
import { isSettingsSchemaUrl } from "./settings.ts";
import { isNavigation, opsCatalogRoute, type SpaFallback } from "./ops-catalog.ts";
import { demoRoutes } from "./demo-owner.ts";
import { makeCallRoute } from "./call-route.ts";
import { instancesReadingsRoute } from "./session-route.ts";
import {
  adminShutdownRoute,
  adminWindowRoute,
  HostLifecycle,
  resolveHostVersion,
  ServiceFileLive,
} from "./host-lifecycle.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { staticSpaLayer } from "./static-spa.ts";
import { peRoutesLayer, peApiErrorsLayer, type HostWork } from "./pe-routes.ts";
import { capturesRoute } from "./captures-route.ts";
import { ductCatalogsRoute } from "./duct-catalogs.ts";
import { pagesRoute } from "./pages-route.ts";
import { makeInstalledUpdateReader, updateRoutes } from "./update-route.ts";
import { UpdateReader, type UpdateFact } from "./update-reader.ts";

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
      bridge.invoke("settings.schema", { schemaUrl }, (yield* sdkSession(bridge)).sessionId),
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
      yield* getHostStatus(
        {
          connected: sessions.length > 0,
          runtimeMatch: sessions.every((session) => session.runtimeMatch === "verified")
            ? "verified"
            : "unknown",
        },
        undefined,
        yield* bridge.lastRegistrationRefusal,
      ),
    );
  }),
);

const noRevitHostStatusRoute = HttpRouter.add("GET", hostProcessIdentity.healthPath, () =>
  Effect.flatMap(getHostStatus({ connected: false }, { revit: false }), Response.json),
);

const emptyNotFound = Effect.succeed(Response.empty({ status: 404 }));

const noRevitBoundary = () =>
  Layer.mergeAll(
    HttpRouter.add("*", BRIDGE_PATH, emptyNotFound),
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

function makeRevitComposition(
  spa: SpaFallback = () => emptyNotFound,
  work?: HostWork,
  origin?: () => string,
) {
  return {
    provider: RevitBridgeLive,
    routes: Layer.mergeAll(
      bridgeWsRoute,
      opsCatalogRoute(spa),
      settingsSchemaRoute,
      hostStatusRoute,
      hostInstallRoute,
      instancesReadingsRoute(currentMachine),
      makeCallRoute(hostActionJournal(), undefined, { workspace: work?.workspace }, { origin }),
    ),
  };
}

export interface HttpLiveOptions {
  /** Preferred listen port (0 = ephemeral, used by the boundary test). */
  readonly port: number;
  readonly capabilities: PeaRuntimeCapabilities;
  /** Injected listener for socket lifecycle tests. */
  readonly nodeServer?: Server;
  readonly share?: ShareOwner;
  readonly devices?: Devices;
  readonly remoteIngress?: readonly { origin: string; transport: "lan" | "ssh" }[];
  /** Browser origin of the separately owned dev frontend. API requests stay here. */
  readonly webUrl?: Deferred.Deferred<string>;
  /** Boot-scoped shutdown latch + service token, injected by the launch root. */
  readonly lifecycle: HostLifecycle["Service"];
  readonly updateReader?: UpdateReader["Service"];
  /** The spine's intake for update facts, handed to the reader this app builds. */
  readonly updateFact?: (fact: UpdateFact) => void;
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
  const receiptOwner = hostActionJournal();
  const ReceiptLifetime = Layer.effectDiscard(
    Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await releaseHostReceiptExport(receiptOwner);
        releaseHostReceipts(receiptOwner);
      }),
    ),
  );
  const UpdateLive = Layer.succeed(
    UpdateReader,
    options.updateReader ?? makeInstalledUpdateReader(options.updateFact),
  );
  const nodeServer = options.nodeServer ?? createServer();
  const remoteConfig = readRemoteIngress(
    join(productRoot(), "state", hostOwnership.serviceName, "remote-ingress.json"),
  );
  const remoteRequests = new WeakSet<object>();
  const remote = remoteConfig ? remoteListener(nodeServer, remoteRequests) : null;
  const RemoteLive =
    remote && remoteConfig
      ? Layer.effectDiscard(
          Effect.acquireRelease(
            Effect.promise(() => remote.start(remoteConfig.listenHost, remoteConfig.port)),
            () => Effect.promise(() => remote.close()),
          ),
        )
      : Layer.empty;
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
    // Reading streams never finish naturally; interrupt them before awaiting server.close.
    disablePreemptiveShutdown: true,
  }).pipe(Layer.provide(RetireSocketsLive));

  const port = () => {
    const address = nodeServer.address();
    return address && typeof address !== "string" ? address.port : options.port;
  };
  const registrations = (options.routeRegistrations ?? createRouteRegistrations)({
    loadedFamilies: (...args) => hostLoadedFamilies(`http://127.0.0.1:${port()}`)(...args),
  });
  const work: HostWork = {
    registrations,
    workspace: new RouteWorkspace({
      registrations,
      store: fileRouteDocumentStore(productRouteWorkPath()),
    }),
  };
  const share =
    options.share ??
    createShare({
      installed: hostOwnership.lane === "installed",
      port,
      run: tailscaleCommand(),
      ...shareIntentFile(join(productRoot(), "state", "share.json")),
    });
  const devices =
    options.devices ??
    createDevices(join(productRoot(), "state", hostOwnership.serviceName, "devices.json"));
  bindControl({ deviceThread: (device) => devices.active(device).thread });
  const identity = requestIdentityLayer({
    devices,
    remoteRequests,
    remoteIngress: options.remoteIngress ?? remoteConfig?.origins,
    port,
    frontendOrigin: () =>
      options.webUrl
        ? Option.getOrUndefined(
            Effect.runSync(Deferred.poll(options.webUrl)).pipe(Option.map(Effect.runSync)),
          )
        : undefined,
    share,
  }).pipe(Layer.provide(peApiErrorsLayer));

  const webUrl = options.webUrl;
  const webRoot = options.webRoot;
  const spa: SpaFallback = webUrl
    ? (req) => Effect.map(Deferred.await(webUrl), (url) => Response.redirect(url + req.originalUrl))
    : webRoot
      ? () => Effect.sync(() => Response.html(readFileSync(join(webRoot, "index.html"), "utf8")))
      : () => emptyNotFound;
  const CommonAppLive = Layer.mergeAll(
    RemoteLive,
    identity,
    shareRoute(share),
    deviceRoutes(devices),
    mcpRoute(() => `http://127.0.0.1:${port()}`),
    capturesRoute(spa),
    pagesRoute(),
    ductCatalogsRoute,
    adminShutdownRoute,
    adminWindowRoute,
    updateRoutes,
    peRoutesLayer(options.routeRegistrations, share, work),
    demoRoutes(),
    webUrl
      ? HttpRouter.add("GET", "/*", (req) => (isNavigation(req) ? spa(req) : emptyNotFound))
      : staticSpaLayer(options.webRoot),
  );

  if (options.capabilities.revit) {
    const revitComposition = (options.revitCompositionFactory ?? makeRevitComposition)(
      spa,
      work,
      () => `http://127.0.0.1:${port()}`,
    );
    // Install the request handler before acquiring/publishing the service claim. A request
    // accepted while claim acquisition awaits SDK work must not be stranded without a handler.
    return ServiceFileLive.pipe(
      Layer.provideMerge(
        HttpRouter.serve(Layer.mergeAll(revitComposition.routes, CommonAppLive)).pipe(
          Layer.provideMerge(ServerLive),
        ),
      ),
      Layer.provide(NodeHttpClient.layerUndici),
      Layer.provide(revitComposition.provider),
      Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
      Layer.provide(UpdateLive),
      Layer.provide(NodeServices.layer),
      Layer.provide(ReceiptLifetime),
    );
  }

  return ServiceFileLive.pipe(
    Layer.provideMerge(
      HttpRouter.serve(
        Layer.mergeAll(
          noRevitBoundary(),
          makeCallRoute(
            hostActionJournal(),
            undefined,
            { workspace: work.workspace },
            { origin: () => `http://127.0.0.1:${port()}` },
          ),
          opsCatalogRoute(spa),
          noRevitHostStatusRoute,
          CommonAppLive,
        ),
      ).pipe(Layer.provideMerge(ServerLive)),
    ),
    // The empty in-memory bridge registry admits no native connection on this composition.
    Layer.provide(RevitBridgeLive),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(UpdateLive),
    Layer.provide(NodeServices.layer),
    Layer.provide(ReceiptLifetime),
  );
}
