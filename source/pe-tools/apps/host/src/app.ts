import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { BRIDGE_PATH, hostProcessIdentity } from "@pe/host-contracts/contracts";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import { getHostStatus } from "./local-ops.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  tsOnlyOperationCatalog,
} from "@pe/host-contracts/operation-types";
import { callRoute } from "./call-route.ts";
import { installRoot, peRevitLauncher, validatePeRevitEnvelope } from "./pe-revit-launch.ts";
import { sandboxesRoute } from "./sandbox-route.ts";
import { adminShutdownRoute, HostLifecycle, ServiceFileLive } from "./host-lifecycle.ts";
import { MastraMountLive, MastraRuntime, withMastraDegrade } from "./mastra-runtime.ts";
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
// connected Revit session (the standard selector header targets one; ?session remains compatible)
// op keys + request/response JSON Schemas as plain JSON. The host-local (TS-only) ops
// are appended so discovery (host_operation_search, pea `operations`, the web ops page)
// sees both surfaces from one catalog; host-typegen skips them by their origin marker.
// A disconnected bridge still lists the local ops (they need no Revit session) with a
// bridgeCatalogError note, rather than a bare 503 — so discovery of e.g. recent-documents
// works with the host up and Revit closed. (host-typegen treats a bridge-op-less catalog
// as "no session" and does not regenerate off the local ops alone.)
const opsCatalogRoute = HttpRouter.add("GET", "/ops", (req) =>
  Effect.gen(function* () {
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

// One-click update: run the install kernel's consume verb against the latest published
// release. The pointer flip makes every open Revit live-swap via the loader; the host itself
// is NOT updated here (its own exe is running — host self-update is a VersionedApp follow-up).
const hostUpdateRoute = HttpRouter.add("POST", "/host/update", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const launch = peRevitLauncher();
    const args = ["install", "apply", "--release", "latest", "--json"] as const;
    const result = yield* Effect.result(
      spawner.string(ChildProcess.make(launch.cmd, [...launch.args, ...args], { cwd: launch.cwd })),
    );
    if (result._tag === "Success") {
      // stdout is the kernel's JSON envelope (verb/actions/verdicts) — pass it through verbatim.
      try {
        return Response.text(validatePeRevitEnvelope(result.success, args, launch), {
          headers: { "content-type": "application/json" },
        });
      } catch (error) {
        return yield* Response.json({ ok: false, error: String(error) }, { status: 500 });
      }
    }
    return yield* Response.json({ ok: false, error: String(result.failure) }, { status: 500 });
  }),
);

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
  const launch = peRevitLauncher();
  yield* Effect.result(
    spawner.string(
      ChildProcess.make(launch.cmd, [...launch.args, "install", "gc", "--json"], {
        cwd: launch.cwd,
      }),
    ),
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
    sandboxesRoute,
    callRoute,
    ServiceFileLive,
    MastraMountLive,
    staticSpaLayer(options.webRoot),
    ...(options.includeInstallGc === false ? [] : [InstallGcLive]),
  );

  return HttpRouter.serve(AppLive).pipe(
    // Provide the tenant BEFORE the server layer so its own HttpServer requirement bubbles up and
    // is satisfied by the same NodeHttpServer.layer below (one bound server, shared). `withMastraDegrade`
    // makes the service claim (a merge sibling) structurally independent of agent-runtime boot: any
    // tenant build failure — failure OR defect — degrades to a 503 tenant instead of collapsing the merge.
    Layer.provide(withMastraDegrade(options.mastraLayer)),
    Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: options.port })),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(RevitBridgeLive),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(NodeServices.layer),
  );
}
