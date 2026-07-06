import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { createServer } from "node:http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { BRIDGE_PATH } from "@pe/host-contracts/contracts";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import {
  HOST_PORT,
  hostOwnership,
  isValidTakeoverToken,
  prepareHostOwnership,
  scheduleShutdown,
} from "./host-ownership.ts";
import { getHostStatus } from "./local-ops.ts";
import { HostRpcServerLive } from "./rpc-server.ts";

const bridgeWsRoute = HttpRouter.add("GET", BRIDGE_PATH, (req) =>
  Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
);

// SSE relay of bridge events (Revit document changes, state syncs, session
// connect/disconnect) so browser query caches can invalidate without polling.
// ponytail: no heartbeat frames; EventSource auto-reconnects through the vite
// dev proxy. Add a keep-alive comment line if a proxy starts dropping idle streams.
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

const hostStatusRoute = HttpRouter.add("GET", "/host/status", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const snapshot = yield* bridge.snapshot(undefined);
    return yield* Response.json(yield* getHostStatus(snapshot));
  }),
);

// One-click update: run the install kernel's consume verb against the latest published
// release. The pointer flip makes every open Revit live-swap via the loader; the host itself
// is NOT updated here (its own exe is running — host self-update is a VersionedApp follow-up).
// PE_REVIT_CMD overrides the launcher for installed machines; dev default is the local tool.
const hostUpdateRoute = HttpRouter.add("POST", "/host/update", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cmd = process.env.PE_REVIT_CMD ?? "dotnet";
    const args = process.env.PE_REVIT_CMD ? [] : ["pe-revit"];
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

const adminShutdownRoute = HttpRouter.add("POST", "/admin/shutdown", (req) => {
  const token = req.headers["x-pe-host-takeover-token"];
  if (!isValidTakeoverToken(token)) return Response.json({ error: "Forbidden" }, { status: 403 });
  scheduleShutdown();
  return Response.json({ shuttingDown: true, lane: hostOwnership.lane });
});

const rpcProtocol = RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
  Layer.provide(HttpRouter.layer),
);

const AppLive = Layer.mergeAll(
  bridgeWsRoute,
  bridgeEventsRoute,
  opsCatalogRoute,
  hostStatusRoute,
  hostUpdateRoute,
  adminShutdownRoute,
  HostRpcServerLive,
).pipe(Layer.provideMerge(rpcProtocol), Layer.provide(RpcSerialization.layerNdjson));

const HttpLive = HttpRouter.serve(AppLive).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: HOST_PORT })),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(RevitBridgeLive),
  Layer.provide(NodeServices.layer),
);

NodeRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      yield* prepareHostOwnership();
      yield* Layer.launch(HttpLive);
    }),
  ),
);
