import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { NodeHttpClient, NodeHttpServer, NodeServices } from "@effect/platform-node";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
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
import { installRoot, peRevitLauncher } from "./pe-revit-launch.ts";
import { sandboxesRoute } from "./sandbox-route.ts";
import { adminShutdownRoute, HostLifecycle, ServiceFileLive } from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { MastraMountLive, MastraRuntime, withMastraDegrade } from "./mastra-runtime.ts";
import { staticSpaLayer } from "./static-spa.ts";
import { viteWebLayer } from "./vite-web.ts";
import type { ViteDevServer } from "vite-plus";

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

// One-click update starts the installed kernel without awaiting it: the add-in is staged for the
// next Revit start, while the versioned host restarts onto the new pointer.
type InstallReceipt = {
  releaseVersion?: string;
  releasesRepo?: string;
  appliedAtUtc?: string;
};

type HostUpdateStatus = {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  error?: string;
};

function readInstallReceipt(): InstallReceipt | null {
  try {
    return JSON.parse(
      readFileSync(join(installRoot(), "install.receipt.json"), "utf8"),
    ) as InstallReceipt;
  } catch {
    return null;
  }
}

// Match `install apply --release latest`: GitHub's latest stable release is the authority.
async function readHostUpdateStatus(): Promise<HostUpdateStatus> {
  const receipt = readInstallReceipt();
  const installedVersion = receipt?.releaseVersion ?? null;
  if (hostOwnership.lane !== "installed" || !receipt?.releasesRepo)
    return { installedVersion, latestVersion: null, updateAvailable: false };

  try {
    const repo = receipt.releasesRepo;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
      throw new Error("installed receipt has an invalid releasesRepo");
    const latest = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Pe.Tools",
      },
    });
    if (!latest.ok) throw new Error(`GitHub latest release returned ${latest.status}`);
    const tag = ((await latest.json()) as { tag_name?: unknown }).tag_name;
    if (typeof tag !== "string" || !tag.trim()) throw new Error("latest release has no tag");
    const latestVersion = tag.replace(/^v/i, "");
    return {
      installedVersion,
      latestVersion,
      // ponytail: exact equality matches the latest-only installer. Add semver ordering only if
      // locally-ahead or prerelease installs become supported.
      updateAvailable: installedVersion !== latestVersion,
    };
  } catch (error) {
    return {
      installedVersion,
      latestVersion: null,
      updateAvailable: false,
      error: String(error),
    };
  }
}

const hostUpdateRoute = HttpRouter.add("POST", "/host/update", () =>
  Effect.tryPromise({
    try: async () => {
      const status = await readHostUpdateStatus();
      if (!status.updateAvailable)
        return Response.jsonUnsafe(
          {
            accepted: false,
            reason:
              status.installedVersion !== null && status.installedVersion === status.latestVersion
                ? "already-current"
                : "update-unavailable",
            ...status,
          },
          { status: 409 },
        );

      const launch = peRevitLauncher();
      const args = ["install", "apply", "--release", "latest", "--json"] as const;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(launch.cmd, [...launch.args, ...args], {
          cwd: launch.cwd,
          // Windows detached children get their own console window. A normal unreferenced child
          // survives this host's planned shutdown without flashing Windows Terminal.
          detached: process.platform !== "win32",
          stdio: "ignore",
          windowsHide: true,
        });
        child.once("error", reject);
        child.once("spawn", () => {
          child.removeAllListeners("error");
          child.on("error", (error) => console.error("pe-revit update child failed", error));
          child.unref();
          resolve();
        });
      });
      return Response.jsonUnsafe({ accepted: true }, { status: 202 });
    },
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      Response.json({ accepted: false, error: String(error) }, { status: 500 }),
    ),
  ),
);

// Installed-version readout for the web Update button — the kernel's receipt is the truth.
const hostInstallRoute = HttpRouter.add("GET", "/host/install", () =>
  Effect.sync(() => {
    const receipt = readInstallReceipt();
    return Response.jsonUnsafe({
      installed: receipt !== null,
      releaseVersion: receipt?.releaseVersion ?? null,
      releasesRepo: receipt?.releasesRepo ?? null,
      appliedAtUtc: receipt?.appliedAtUtc ?? null,
    });
  }),
);

const hostUpdateStatusRoute = HttpRouter.add("GET", "/host/update", () =>
  Effect.promise(async () => Response.jsonUnsafe(await readHostUpdateStatus())),
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
  /** Optional shared Node listener; dev gives the same object to Vite middleware/HMR. */
  readonly nodeServer?: Server;
  /** Programmatic Vite server in dev; installed mode leaves this absent and serves static files. */
  readonly viteServer?: ViteDevServer;
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
  const ServerLive = NodeHttpServer.layer(() => options.nodeServer ?? createServer(), {
    host: "127.0.0.1",
    port: options.port,
  });
  const ClaimedServerLive = Layer.mergeAll(
    ServerLive,
    ServiceFileLive.pipe(Layer.provide(ServerLive)),
  );

  const AppLive = Layer.mergeAll(
    bridgeWsRoute,
    bridgeEventsRoute,
    opsCatalogRoute,
    settingsSchemaRoute,
    hostStatusRoute,
    hostUpdateRoute,
    hostUpdateStatusRoute,
    hostInstallRoute,
    adminShutdownRoute,
    sandboxesRoute,
    callRoute,
    MastraMountLive,
    options.viteServer ? viteWebLayer(options.viteServer) : staticSpaLayer(options.webRoot),
    ...(options.includeInstallGc === false ? [] : [InstallGcLive]),
  );

  return HttpRouter.serve(AppLive).pipe(
    // ClaimedServerLive binds and completes takeover before the tenant opens shared product state.
    // The tenant still receives that same HttpServer, and any runtime failure degrades only /pe/*.
    Layer.provide(withMastraDegrade(options.mastraLayer)),
    Layer.provide(ClaimedServerLive),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(RevitBridgeLive),
    Layer.provide(Layer.succeed(HostLifecycle, options.lifecycle)),
    Layer.provide(NodeServices.layer),
  );
}
