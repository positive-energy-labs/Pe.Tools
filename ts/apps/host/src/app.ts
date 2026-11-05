import { HostInputContext } from "./input-context.ts";
import { hostDescriptor } from "@pe/host-contracts/host-descriptor";
import { hostNativeReadFor } from "./native-recording.ts";
import { httpProblems } from "./http-problems.ts";
import { InvalidRead } from "./native-reads.ts";
import { nativeCallRoute, nativeReadResolveRoute } from "./call-route.ts";
import { Spawner } from "./harness/spawner.ts";
import { currentMachine } from "./machine.ts";
import { SdkSession, SdkDriverLive } from "./sdk-session.ts";
import { ReadFreshness, RequestIdentity } from "./request-services.ts";
import { NativeReads } from "./native-reads.ts";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { HostNativeReadLive } from "./native-read.ts";
import { requestIdentityLayer } from "./request-identity.ts";
import { createDevices, type Devices } from "./remote-device.ts";
import { deviceRoutes } from "./device-routes.ts";
import { bindControl, Refused } from "./control.ts";
import { readRemoteIngress, remoteListener } from "./remote-ingress.ts";
import {
  createShare,
  shareIntentFile,
  shareRoute,
  tailscaleCommand,
  type ShareOwner,
} from "./share.ts";
import { mcpRoute } from "./mcp-route.ts";
import { Context, Deferred, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { BRIDGE_PATH, hostProcessIdentity } from "@pe/host-contracts/contracts";
import { RouteWorkspace, type PeaRuntimeCapabilities } from "@pe/runtime";
import { createRouteRegistrations } from "@pe/mcps";
import { admittedBuiltinsLayer, constructorWorkRegistrations } from "./admitted-builtins.ts";
import { catalogWorkSpecs } from "@pe/agent-contracts";
import { hostLoadedFamilies } from "../../../packages/mcps/src/pea/families-admission.ts";
import { fileRouteDocumentStore } from "./route-document-store.ts";
import { productRouteWorkPath } from "./product-paths.ts";
import { HostReceipts } from "./gateway-owner.ts";
import { ReceiptExport, type ReceiptExporter } from "./receipt-export.ts";
import { CaptureStore } from "./takeoff-captures.ts";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { RunConsents } from "./run-consent.ts";
import { getHostStatus } from "./local-ops.ts";
import { isSettingsSchemaUrl } from "./settings.ts";
import { isNavigation, opsCatalogRoute, type SpaFallback } from "./ops-catalog.ts";
import { demoRoutes } from "./demo-owner.ts";
import { makeCallRoute } from "./call-route.ts";
import { FamiliesReader } from "./families-reader.ts";
import { instancesReadingsRoute } from "./session-route.ts";
import {
  adminShutdownRoute,
  adminWindowRoute,
  HostLifecycle,
  resolveHostVersion,
  ServiceFileLive,
} from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { staticSpaLayer } from "./static-spa.ts";
import { peRoutesLayer, peApiErrorsLayer, type HostWork } from "./pe-routes.ts";
import { threadPointerPort } from "./thread-pointers.ts";
import { capturesRoute } from "./captures-route.ts";
import { ductCatalogsRoute, HostFiles } from "./host-files.ts";
import { HostDocumentMarks } from "./document-marks.ts";
import { PictureCaptureStore } from "./captures-route.ts";
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
export const settingsSchemaRoute = HttpRouter.add("GET", "/schemas/settings/*", (req) =>
  Effect.gen(function* () {
    const identity = yield* RequestIdentity;
    const schemaUrl = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`).href;
    if (!isSettingsSchemaUrl(schemaUrl))
      return Response.jsonUnsafe({ error: `No schema at ${schemaUrl}` }, { status: 404 });
    const result = yield* Effect.result(
      (yield* HostNativeRead).read({ key: "settings.schema", input: { schemaUrl }, scope: identity.scope }),
    );
    if (result._tag === "Failure")
      return Response.jsonUnsafe(
        { error: String(result.failure.message ?? result.failure) },
        { status: result.failure.status },
      );
    const value = result.success.value;
    const schemaJson = value && typeof value === "object" && "schemaJson" in value ? value.schemaJson : undefined;
    if (typeof schemaJson !== "string" || !schemaJson)
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
      Layer.unwrap(
        Effect.gen(function* () {
          const families = yield* FamiliesReader;
          return makeCallRoute(
            (yield* HostReceipts).journal,
            undefined,
            { workspace: work?.workspace },
            { origin, families, pointers: work?.pointers },
          );
        }),
      ),
    ),
  };
}

/** Build once outside sibling routes, then expose that exact context to each request. */
const guardedNativeRead = Layer.effect(HostNativeRead, Effect.gen(function* () {
  const reads = yield* HostNativeRead;
  const inputs = yield* HostInputContext;
  return {
    read: (request: Parameters<typeof reads.read>[0]) => {
      const refusal = inputs.check({ kind: "native", key: request.key });
      return refusal ? Effect.fail(refusal) : reads.read(request);
    },
    resolve: (request: Parameters<typeof reads.resolve>[0]) => {
      const refusal = inputs.check({ kind: "native", key: request.key });
      return refusal ? Effect.fail(refusal) : reads.resolve(request);
    },
  };
}));

export const nativeReadRoot = (driver = SdkDriverLive, inputs?: HostInputContext["Service"]) => <A, E, R>(routes: Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.gen(function* () {
    const source = inputs ?? (yield* HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" }))));
    if (source.lane.kind !== "live") return yield* Effect.die(Error("Live native root requires a live input graph"));
    const base = yield* Layer.build(Layer.mergeAll(
      SdkSession.layer.pipe(Layer.provide(driver)), ReadFreshness.layer, NativeReads.layer,
    ));
    const backend = HostNativeReadLive.pipe(Layer.provide(Layer.succeedContext(base)));
    const reads = yield* Layer.build(guardedNativeRead.pipe(
      Layer.provide(hostNativeReadFor(source.lane, backend)),
      Layer.provideMerge(Layer.succeed(HostInputContext, source)),
    ));
    const provided = Layer.succeedContext(Context.merge(base, reads));
    return routes.pipe(HttpRouter.provideRequest(provided), Layer.provide(provided));
  }));

/** Recording has no live service requirements; this recipe is never acquired on replay. */
const liveNativeRecipe = HostNativeReadLive.pipe(
  Layer.provide(Layer.mergeAll(SdkSession.layer.pipe(Layer.provide(SdkDriverLive)), ReadFreshness.layer, NativeReads.layer)),
  Layer.provide(RevitBridgeLive),
);

export const historicalRoutes = (inputs: HostInputContext["Service"]) => Layer.unwrap(Effect.gen(function* () {
  const context = yield* Layer.build(guardedNativeRead.pipe(
    Layer.provide(hostNativeReadFor(inputs.lane, liveNativeRecipe)),
    Layer.provideMerge(Layer.succeed(HostInputContext, inputs)),
  ));
  const provided = Layer.succeedContext(context);
  return Layer.mergeAll(
  nativeCallRoute, nativeReadResolveRoute,
  HttpRouter.add("GET", "/pe/features", Response.jsonUnsafe(hostDescriptor(resolveHostVersion()), {
    headers: { "x-pe-source": JSON.stringify(inputs.source) },
  })),
  HttpRouter.add("GET", hostProcessIdentity.healthPath, () => Response.json({ source: inputs.source })),
  HttpRouter.add("*", "/*", (req) => Effect.gen(function* () {
    const path = new URL(req.url, "http://host").pathname;
    if (path === "/actions" && req.method === "POST") {
      const body = yield* req.json.pipe(Effect.catch(() => Effect.succeed(null)));
      if (body && typeof body === "object" && "key" in body && typeof body.key === "string") {
        const denied = inputs.check({ kind: "command", key: body.key });
        if (denied) return yield* denied;
      }
    }
    const denied = req.method === "GET" || path.includes("/ducts/")
      ? inputs.check({ kind: "input", input: "document" })
      : inputs.check({ kind: "work", verb: "edit" });
    return yield* (denied ?? new InvalidRead({ message: "Historical source input is unavailable", status: 409, problem: "recording.coverage" }));
  })),
).pipe(
  Layer.provide(httpProblems),
  HttpRouter.provideRequest(provided), Layer.provide(provided),
);
}));

/** Root-fixed selection: the live factory is not even called on a historical/fixture lane. */
export const hostInputGraph = <A, E, R, B, F, S>(inputs: HostInputContext["Service"], live: () => Layer.Layer<A, E, R>, recording: () => Layer.Layer<B, F, S>): Layer.Layer<A & B, E | F, R | S> =>
  inputs.lane.kind === "live" ? live() : recording();

/** Both source graphs retire browser sockets after the platform listener closes. */
const hostServerLayer = (server: Server, port: number) => NodeHttpServer.layer(() => server, {
  host: "127.0.0.1", port, disablePreemptiveShutdown: true,
}).pipe(Layer.provide(Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => {
  server.closeIdleConnections(); server.closeAllConnections();
})))));

function historicalHttpLive(options: HttpLiveOptions) {
  const server = options.nodeServer ?? createServer();
  const port = () => { const address = server.address(); return address && typeof address !== "string" ? address.port : options.port; };
  const identity = requestIdentityLayer({
    port, frontendOrigin: Effect.succeed(undefined),
    share: { read: async () => { throw new Refused({ code: "context.missing", door: "historical host", reason: "Historical host admits local transport only" }); }, observe: () => {} },
  });
  return ServiceFileLive.pipe(Layer.provideMerge(HttpRouter.serve(historicalRoutes(options.inputs).pipe(
    Layer.provide(identity),
  )).pipe(Layer.provideMerge(hostServerLayer(server, options.port)))),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)), Layer.provide(NodeServices.layer));
}

export interface HttpLiveOptions {
  /** Preferred listen port (0 = ephemeral, used by the boundary test). */
  readonly inputs: HostInputContext["Service"];
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
  /**
   * The launch root's exporter, so the boot record and update facts share it with the routes; a
   * composition without one builds its own `ReceiptExport` layer for this app's scope.
   */
  readonly receipts?: ReceiptExporter;
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
  return hostInputGraph(options.inputs, () => liveHttpLive(options), () => historicalHttpLive(options));
}

function liveHttpLive(options: HttpLiveOptions) {
  const ReceiptsLive = options.receipts
    ? Layer.succeed(ReceiptExport, options.receipts)
    : ReceiptExport.layer({ host: null, web: null });
  const UpdateLive = Layer.succeed(
    UpdateReader,
    options.updateReader ?? makeInstalledUpdateReader(options.updateFact),
  );
  const nodeServer = options.nodeServer ?? createServer();
  // Both lanes wait for explicit reads until completion or disconnect; upload limits stay intact.
  nodeServer.setTimeout(0);
  const remoteConfig = readRemoteIngress(
    join(hostOwnership.rootPath, "state", hostOwnership.serviceName, "remote-ingress.json"),
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
  const ServerLive = hostServerLayer(nodeServer, options.port);

  const port = () => {
    const address = nodeServer.address();
    return address && typeof address !== "string" ? address.port : options.port;
  };
  const registrations = [
    ...(options.routeRegistrations ?? createRouteRegistrations)({
      loadedFamilies: (...args) => hostLoadedFamilies(`http://127.0.0.1:${port()}`)(...args),
    }),
    // Route-free catalog owners: Work with no Page (ADR 0030 rule 2). Pea's doors list them like any Work.
    ...Object.values(catalogWorkSpecs).map((spec) => ({ spec })),
  ];
  const work: HostWork = {
    // Pea's catalog lists every Work route (ADR 0030 rule 1).
    registrations,
    pointers: threadPointerPort(options.inputs),
    workspace: new RouteWorkspace({
      registrations: constructorWorkRegistrations(registrations),
      store: fileRouteDocumentStore(productRouteWorkPath()),
      authorizeMutation: (verb) => { const denied = options.inputs.check({ kind: "work", verb }); if (denied) throw denied; },
    }),
  };
  const share =
    options.share ??
    createShare({
      installed: hostOwnership.lane === "installed",
      port,
      run: tailscaleCommand(),
      ...shareIntentFile(join(hostOwnership.rootPath, "state", "share.json")),
    });
  const devices =
    options.devices ??
    createDevices(join(hostOwnership.rootPath, "state", hostOwnership.serviceName, "devices.json"));
  bindControl({ deviceThread: (device) => devices.active(device).thread });
  const identity = requestIdentityLayer({
    devices,
    remoteRequests,
    remoteIngress: options.remoteIngress ?? remoteConfig?.origins,
    port,
    // Read on each request's fiber: the dev frontend's URL settles after the layer is built.
    frontendOrigin: options.webUrl
      ? Deferred.poll(options.webUrl).pipe(
          Effect.flatMap(
            Option.match({ onNone: () => Effect.succeed(undefined), onSome: (url) => url }),
          ),
        )
      : Effect.succeed(undefined),
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

  const revit = options.capabilities.revit;
  const composition = revit
    ? (options.revitCompositionFactory ?? makeRevitComposition)(
        spa,
        work,
        () => `http://127.0.0.1:${port()}`,
      )
    : {
        provider: RevitBridgeLive,
        routes: Layer.mergeAll(
          noRevitBoundary(),
          Layer.unwrap(
            Effect.gen(function* () {
              return makeCallRoute(
                (yield* HostReceipts).journal,
                undefined,
                { workspace: work.workspace },
                { origin: () => `http://127.0.0.1:${port()}`, pointers: work.pointers },
              );
            }),
          ),
          opsCatalogRoute(spa),
          noRevitHostStatusRoute,
        ),
      };
  // The request handler is installed before publishing the claim. Readers and marks close
  // before the bridge; the composing runtime owns receipts beyond all of these resources.
  return ServiceFileLive.pipe(
    Layer.provideMerge(
      HttpRouter.serve(
        Layer.mergeAll(composition.routes, CommonAppLive).pipe(
          Layer.provide(identity), nativeReadRoot(SdkDriverLive, options.inputs),
        ),
      ).pipe(Layer.provideMerge(ServerLive)),
    ),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(FamiliesReader.layer),
    Layer.provide(HostDocumentMarks.layer),
    Layer.provide(composition.provider),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(UpdateLive),
    Layer.provide(RunConsents.layer),
    Layer.provide(Spawner.live),
    Layer.provide(CaptureStore.layer()),
    Layer.provide(HostFiles.layer()),
    Layer.provide(PictureCaptureStore.layer()),
    Layer.provide(ReceiptsLive),
    Layer.provide(NodeServices.layer),
    Layer.provide(admittedBuiltinsLayer(work.workspace, undefined, registrations)),
  );
}
