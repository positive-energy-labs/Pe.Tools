import { Effect, Layer, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse as Response,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { createServer } from "node:http";
import { BRIDGE_PATH } from "@pe/host-contracts/contracts";
import { openSettingsDocumentRequestSchema } from "@pe/host-contracts/operation-types";
import { RevitBridge, RevitBridgeLive } from "./bridge.ts";
import {
  HOST_PORT,
  hostOwnership,
  isValidTakeoverToken,
  prepareHostOwnership,
  scheduleShutdown,
} from "./host-ownership.ts";
import { localOpHttpStatus } from "./local-error.ts";
import { getHostStatus } from "./local-ops.ts";
import { HostRpcServerLive } from "./rpc-server.ts";
import { openSettingsDocumentWithModule } from "./settings.ts";

const bridgeWsRoute = HttpRouter.add("GET", BRIDGE_PATH, (req) =>
  Effect.flatMap(RevitBridge, (bridge) => bridge.handleConnection(req)),
);

const hostStatusRoute = HttpRouter.add("GET", "/host/status", () =>
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const snapshot = yield* bridge.snapshot(undefined);
    return yield* Response.json(yield* getHostStatus(snapshot));
  }),
);

const adminShutdownRoute = HttpRouter.add("POST", "/admin/shutdown", (req) => {
  const token = req.headers["x-pe-host-takeover-token"];
  if (!isValidTakeoverToken(token)) return Response.json({ error: "Forbidden" }, { status: 403 });
  scheduleShutdown();
  return Response.json({ shuttingDown: true, lane: hostOwnership.lane });
});

const settingsOpenRoute = HttpRouter.add("POST", "/api/settings/document/open", () =>
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(settingsOpenBodySchema);
    const snapshot = yield* openSettingsDocumentWithModule(body.request, body.module, {
      schemaJson: body.schemaJson,
    });
    return yield* Response.json(snapshot);
  }).pipe(
    Effect.catch((error: unknown) =>
      Response.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        { status: localOpHttpStatus(error) },
      ),
    ),
  ),
);

const rpcProtocol = RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
  Layer.provide(HttpRouter.layer),
);

const AppLive = Layer.mergeAll(
  bridgeWsRoute,
  hostStatusRoute,
  adminShutdownRoute,
  settingsOpenRoute,
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

const settingsModuleDescriptorSchema = Schema.Struct({
  moduleKey: Schema.String,
  defaultRootKey: Schema.String,
  roots: Schema.Array(
    Schema.Struct({
      rootKey: Schema.String,
      displayName: Schema.String,
    }),
  ),
  storageOptions: Schema.optional(
    Schema.Struct({
      includeRoots: Schema.optional(Schema.Array(Schema.String)),
      presetRoots: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

const settingsOpenBodySchema = Schema.Struct({
  request: openSettingsDocumentRequestSchema,
  module: settingsModuleDescriptorSchema,
  schemaJson: Schema.optional(Schema.String),
});
