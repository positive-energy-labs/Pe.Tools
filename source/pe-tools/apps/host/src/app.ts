import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { BRIDGE_PATH, productIdentity } from "@pe/host-contracts/contracts";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { getHostStatus } from "./local-ops.ts";
import { callRoute } from "./call-route.ts";
import { adminShutdownRoute, HostLifecycle, ServiceFileLive } from "./host-lifecycle.ts";
import { MastraMountLive, MastraRuntime } from "./mastra-runtime.ts";
import { staticSpaLayer } from "./static-spa.ts";

export { MastraRuntimeLive } from "./mastra-runtime.ts";
export { resolveWebRoot } from "./static-spa.ts";

const bridgeWsRoute = HttpRouter.add("GET", BRIDGE_PATH, (req) =>
  Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
);

// SSE relay of bridge events (Revit document changes, state syncs, session
// connect/disconnect) so browser query caches can invalidate without polling.
// ponytail: no heartbeat frames; EventSource auto-reconnects. Add a keep-alive comment
// line if a proxy starts dropping idle streams.
const bridgeEventsRoute = HttpRouter.add("GET", "/events", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const encoder = new TextEncoder();
    const body = Stream.fromPubSub(bridge.events).pipe(
      Stream.map((event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    );
    return Response.stream(body, {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", connection: "keep-alive" },
    });
  }),
);

// Runtime operation catalog for browsers/typegen: proxies host.ops.catalog to the
// connected Revit session (?session=<bridgeSessionId> to target one) and returns
// op keys + request/response JSON Schemas as plain JSON.
const opsCatalogRoute = HttpRouter.add("GET", "/ops", (req) =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const sessionParam = new URL(req.url, "http://localhost").searchParams.get("session");
    const result = yield* Effect.result(
      bridge.invoke("host.ops.catalog", {}, sessionParam ?? undefined),
    );
    if (result._tag === "Failure")
      return Response.jsonUnsafe(
        { error: String(result.failure.message ?? result.failure) },
        { status: 503 },
      );
    return Response.jsonUnsafe(result.success);
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
      bridge.invoke("settings.schema", { moduleKey, rootKey }, undefined),
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

const hostStatusRoute = HttpRouter.add("GET", "/host/status", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const snapshot = yield* bridge.snapshot(undefined);
    return yield* Response.json(yield* getHostStatus(snapshot));
  }),
);

// Launch chain for the install kernel: PE_REVIT_CMD env override → the kernel-installed shim
// (user machines) → `dotnet pe-revit` (dev checkout, local tool). Resolved per call — the shim
// can appear after the host started.
function peRevitLauncher(): [string, string[]] {
  const installedShim = join(installRoot(), "shims", "pe-revit.cmd");
  return process.env.PE_REVIT_CMD
    ? [process.env.PE_REVIT_CMD, []]
    : existsSync(installedShim)
      ? ["cmd", ["/c", installedShim]]
      : ["dotnet", ["pe-revit"]];
}

// One-click update: run the install kernel's consume verb against the latest published
// release. The pointer flip makes every open Revit live-swap via the loader; the host itself
// is NOT updated here (its own exe is running — host self-update is a VersionedApp follow-up).
const hostUpdateRoute = HttpRouter.add("POST", "/host/update", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const [cmd, args] = peRevitLauncher();
    const result = yield* Effect.result(
      spawner.string(
        ChildProcess.make(cmd, [...args, "install", "apply", "--release", "latest", "--json"]),
      ),
    );
    if (result._tag === "Success")
      // stdout is the kernel's JSON envelope (verb/actions/verdicts) — pass it through verbatim.
      return Response.text(result.success, { headers: { "content-type": "application/json" } });
    return yield* Response.json({ ok: false, error: String(result.failure) }, { status: 500 });
  }),
);

function installRoot() {
  return join(
    process.env.LOCALAPPDATA ?? "",
    productIdentity.vendorName,
    productIdentity.productName,
  );
}

// Installed-version readout for the web Update button — the kernel's receipt is the truth.
const hostInstallRoute = HttpRouter.add("GET", "/host/install", () =>
  Effect.sync(() => {
    try {
      const receipt = JSON.parse(
        readFileSync(join(installRoot(), "install.receipt.json"), "utf8"),
      ) as { releaseVersion?: string; releasesRepo?: string; appliedAtUtc?: string };
      return Response.jsonUnsafe({
        installed: true,
        releaseVersion: receipt.releaseVersion ?? null,
        releasesRepo: receipt.releasesRepo ?? null,
        appliedAtUtc: receipt.appliedAtUtc ?? null,
      });
    } catch {
      return Response.jsonUnsafe({
        installed: false,
        releaseVersion: null,
        releasesRepo: null,
        appliedAtUtc: null,
      });
    }
  }),
);

// Routine cleanup, always on: the kernel's `install gc` prunes version dirs (keep 3), sweeps
// the manifest's declared legacy paths and rename-aside strays — lock-tolerant and idempotent.
// Runs at host start and on every Revit session disconnect (the moment its file locks vanish),
// so hot-swap releases never accumulate cruft. Failures are swallowed: gc is best-effort.
const runInstallGc = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [cmd, args] = peRevitLauncher();
  yield* Effect.result(
    spawner.string(ChildProcess.make(cmd, [...args, "install", "gc", "--json"])),
  );
});

const InstallGcLive = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.forkScoped(runInstallGc);
    const bridge = yield* RevitBridge;
    yield* Effect.forkScoped(
      Stream.fromPubSub(bridge.events).pipe(
        Stream.filter((event) => event.kind === "disconnected"),
        Stream.runForEach(() => runInstallGc),
      ),
    );
  }),
);

export interface HttpLiveOptions {
  /** Preferred listen port (0 = ephemeral, used by the boundary test). */
  readonly port: number;
  /**
   * The Mastra tenant layer; the boundary test swaps a trivial stub (RIn = never) for the real
   * runtime (RIn = HttpServer). `HttpServer` is satisfied by the shared `NodeHttpServer.layer`.
   */
  readonly mastraLayer: Layer.Layer<MastraRuntime, unknown, HttpServer.HttpServer>;
  /** Boot-scoped shutdown latch + service token, injected by the launch root. */
  readonly lifecycle: HostLifecycle["Service"];
  /** Built SPA directory, or null to skip static serving (dev/vite). */
  readonly webRoot: string | null;
  /**
   * Whether to run the background install-gc sweeps. Omitted in the boundary test so it does not
   * spawn the install kernel; defaults on for production.
   */
  readonly includeInstallGc?: boolean;
}

/**
 * Assemble the full host app + server as one launchable Layer. `mastraLayer` and `port` are
 * parameters so the boundary test can boot the real composition on an ephemeral port with a stub
 * tenant. HttpServer is provided once (via `NodeHttpServer.layer`) and shared by the router, the
 * Mastra tenant (bound loopback -> hostBaseUrl), and the service-file writer.
 */
export function makeHttpLive(options: HttpLiveOptions) {
  const AppLive = Layer.mergeAll(
    bridgeWsRoute,
    bridgeEventsRoute,
    opsCatalogRoute,
    settingsSchemaRoute,
    hostStatusRoute,
    hostUpdateRoute,
    hostInstallRoute,
    adminShutdownRoute,
    callRoute,
    ServiceFileLive,
    MastraMountLive,
    staticSpaLayer(options.webRoot),
    ...(options.includeInstallGc === false ? [] : [InstallGcLive]),
  );

  return HttpRouter.serve(AppLive).pipe(
    // Provide the tenant BEFORE the server layer so its own HttpServer requirement bubbles up and
    // is satisfied by the same NodeHttpServer.layer below (one bound server, shared).
    Layer.provide(options.mastraLayer),
    Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: options.port })),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(RevitBridgeLive),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(NodeServices.layer),
  );
}
