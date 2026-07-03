import { Effect, Layer, Schema } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import { RevitBridge } from "./bridge.ts";
import { BridgeError, NoRevitSession } from "./bridge.ts";
import { dispatchHostOperation, InvalidHostRequest, InvalidHostResponse } from "./dispatch.ts";
import { apsAuthLogin, apsAuthLogout, apsAuthStatus, apsAuthToken } from "./aps-auth.ts";
import {
  collectRecentDocuments,
  discoverSettingsTree,
  getBridgeSessionSummary,
  getHostStatus,
  getSettingsWorkspaces,
  listBridgeSessions,
  openSettingsDocument,
  openSettingsDocumentWithModule,
  saveSettingsDocument,
  tailLogs,
  validateSettingsDocument,
} from "./local-ops.ts";
import { LocalOpError, localOpHttpStatus } from "./local-error.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  isHostOperationKey,
  tsOnlyOperationSchemas,
  type TsOnlyOperationKey,
} from "@pe/host-contracts/operation-types";
import {
  HostRpcError,
  HostRpcs,
  makeBridgeOperationRpcHandlers,
  type BridgeOperationRpcHandler,
} from "@pe/host-contracts/rpc";
import type { HostErrorKind } from "@pe/host-contracts/contracts";

export const HostRpcHandlers = HostRpcs.toLayer(
  Effect.gen(function* () {
    const bridge = yield* RevitBridge;
    const dispatchBridgeOperation: BridgeOperationRpcHandler = (key, request) =>
      mapHostRpcError(key, dispatchHostOperation(key, request, bridge));

    return HostRpcs.of({
      ...makeBridgeOperationRpcHandlers(dispatchBridgeOperation),
      "host.call": Effect.fnUntraced(function* ({ key, request }, options) {
        const bridgeSessionId = bridgeSessionIdFromOptions(options);
        if (isHostOperationKey(key))
          return yield* mapHostRpcError(
            key,
            dispatchHostOperation(key, request, bridge, bridgeSessionId),
          );
        return yield* mapHostRpcError(key, dispatchTsOnlyOperation(key, request, bridgeSessionId));
      }),
      "host.status": Effect.fnUntraced(function* (_, options) {
        const bridgeSessionId = bridgeSessionIdFromOptions(options);
        return yield* mapHostRpcError(
          "host.status",
          dispatchTsOnlyRpcOperation(
            "host.status",
            undefined,
            bridgeSessionId,
            tsOnlyOperationSchemas["host.status"].response,
          ),
        );
      }),
      "bridge.sessions.summary": Effect.fnUntraced(function* (_, options) {
        const bridgeSessionId = bridgeSessionIdFromOptions(options);
        return yield* mapHostRpcError(
          "bridge.sessions.summary",
          dispatchTsOnlyRpcOperation(
            "bridge.sessions.summary",
            undefined,
            bridgeSessionId,
            tsOnlyOperationSchemas["bridge.sessions.summary"].response,
          ),
        );
      }),
      "bridge.sessions.list": Effect.fnUntraced(function* () {
        return yield* mapHostRpcError(
          "bridge.sessions.list",
          dispatchTsOnlyRpcOperation(
            "bridge.sessions.list",
            undefined,
            undefined,
            tsOnlyOperationSchemas["bridge.sessions.list"].response,
          ),
        );
      }),
      "logs.tail": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "logs.tail",
          dispatchTsOnlyRpcOperation(
            "logs.tail",
            request,
            undefined,
            tsOnlyOperationSchemas["logs.tail"].response,
          ),
        );
      }),
      "settings.workspaces": Effect.fnUntraced(function* (_, options) {
        const bridgeSessionId = bridgeSessionIdFromOptions(options);
        return yield* mapHostRpcError(
          "settings.workspaces",
          dispatchTsOnlyRpcOperation(
            "settings.workspaces",
            undefined,
            bridgeSessionId,
            tsOnlyOperationSchemas["settings.workspaces"].response,
          ),
        );
      }),
      "settings.tree": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "settings.tree",
          dispatchTsOnlyRpcOperation(
            "settings.tree",
            request,
            undefined,
            tsOnlyOperationSchemas["settings.tree"].response,
          ),
        );
      }),
      "settings.document.open": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "settings.document.open",
          dispatchTsOnlyRpcOperation(
            "settings.document.open",
            request,
            undefined,
            tsOnlyOperationSchemas["settings.document.open"].response,
          ),
        );
      }),
      "settings.document.open-with-module": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "settings.document.open-with-module",
          dispatchTsOnlyRpcOperation(
            "settings.document.open-with-module",
            request,
            undefined,
            tsOnlyOperationSchemas["settings.document.open-with-module"].response,
          ),
        );
      }),
      "settings.document.validate": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "settings.document.validate",
          dispatchTsOnlyRpcOperation(
            "settings.document.validate",
            request,
            undefined,
            tsOnlyOperationSchemas["settings.document.validate"].response,
          ),
        );
      }),
      "settings.document.save": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "settings.document.save",
          dispatchTsOnlyRpcOperation(
            "settings.document.save",
            request,
            undefined,
            tsOnlyOperationSchemas["settings.document.save"].response,
          ),
        );
      }),
      "revit.catalog.recent-documents": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "revit.catalog.recent-documents",
          dispatchTsOnlyRpcOperation(
            "revit.catalog.recent-documents",
            request,
            undefined,
            tsOnlyOperationSchemas["revit.catalog.recent-documents"].response,
          ),
        );
      }),
      "aps.auth.status": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "aps.auth.status",
          dispatchTsOnlyRpcOperation(
            "aps.auth.status",
            request,
            undefined,
            tsOnlyOperationSchemas["aps.auth.status"].response,
          ),
        );
      }),
      "aps.auth.login": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "aps.auth.login",
          dispatchTsOnlyRpcOperation(
            "aps.auth.login",
            request,
            undefined,
            tsOnlyOperationSchemas["aps.auth.login"].response,
          ),
        );
      }),
      "aps.auth.logout": Effect.fnUntraced(function* () {
        return yield* mapHostRpcError(
          "aps.auth.logout",
          dispatchTsOnlyRpcOperation(
            "aps.auth.logout",
            undefined,
            undefined,
            tsOnlyOperationSchemas["aps.auth.logout"].response,
          ),
        );
      }),
      "aps.auth.token": Effect.fnUntraced(function* (request) {
        return yield* mapHostRpcError(
          "aps.auth.token",
          dispatchTsOnlyRpcOperation(
            "aps.auth.token",
            request,
            undefined,
            tsOnlyOperationSchemas["aps.auth.token"].response,
          ),
        );
      }),
    });
  }),
);

export const HostRpcServerLive = RpcServer.layer(HostRpcs).pipe(Layer.provide(HostRpcHandlers));

type RpcRequestOptions = {
  readonly headers?: {
    readonly [name: string]: string | undefined;
  };
};

function bridgeSessionIdFromOptions(options: RpcRequestOptions | undefined): string | undefined {
  const value = options?.headers?.[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim();
  return value ? value : undefined;
}

const dispatchTsOnlyRpcOperation = Effect.fnUntraced(function* <A>(
  key: TsOnlyOperationKey,
  request: unknown,
  bridgeSessionId: string | undefined,
  responseSchema: Schema.Codec<A>,
) {
  const response = yield* dispatchTsOnlyOperation(key, request, bridgeSessionId);
  return yield* Schema.decodeUnknownEffect(responseSchema)(response).pipe(
    Effect.mapError((error) => new InvalidHostResponse(key, error.message)),
  );
});

const dispatchTsOnlyOperation = Effect.fnUntraced(function* (
  key: TsOnlyOperationKey,
  request: unknown,
  bridgeSessionId: string | undefined,
) {
  const bridge = yield* RevitBridge;
  switch (key) {
    case "host.status":
      yield* validateTsOnlyNoRequest(key, request);
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getHostStatus);
    case "bridge.sessions.summary":
      yield* validateTsOnlyNoRequest(key, request);
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getBridgeSessionSummary);
    case "bridge.sessions.list":
      yield* validateTsOnlyNoRequest(key, request);
      return yield* listBridgeSessions(bridge.list);
    case "logs.tail": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["logs.tail"].request,
        request,
      );
      return yield* tailLogs(decoded);
    }
    case "settings.workspaces": {
      yield* validateTsOnlyNoRequest(key, request);
      const bridgeView = yield* bridge.snapshot(bridgeSessionId);
      return yield* getSettingsWorkspaces({
        bridge: bridgeView,
        invokeBridge: (operationKey, payload) =>
          bridge.invoke(operationKey, payload, bridgeSessionId),
      });
    }
    case "settings.tree": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["settings.tree"].request,
        request,
      );
      return yield* discoverSettingsTree(decoded, {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    }
    case "settings.document.open": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["settings.document.open"].request,
        request,
      );
      return yield* openSettingsDocument(decoded, {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    }
    case "settings.document.open-with-module": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["settings.document.open-with-module"].request,
        request,
      );
      return yield* openSettingsDocumentWithModule(decoded.request, decoded.module, {
        schemaJson: decoded.schemaJson,
      });
    }
    case "settings.document.validate": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["settings.document.validate"].request,
        request,
      );
      return yield* validateSettingsDocument(decoded, {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    }
    case "settings.document.save": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["settings.document.save"].request,
        request,
      );
      return yield* saveSettingsDocument(decoded, {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    }
    case "revit.catalog.recent-documents": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["revit.catalog.recent-documents"].request,
        request,
      );
      return yield* collectRecentDocuments(decoded);
    }
    case "aps.auth.status": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["aps.auth.status"].request,
        request,
      );
      return yield* apsAuthStatus(decoded);
    }
    case "aps.auth.login": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["aps.auth.login"].request,
        request,
      );
      return yield* apsAuthLogin(decoded);
    }
    case "aps.auth.logout":
      yield* validateTsOnlyNoRequest(key, request);
      return yield* apsAuthLogout();
    case "aps.auth.token": {
      const decoded = yield* decodeTsOnlyRequest(
        key,
        tsOnlyOperationSchemas["aps.auth.token"].request,
        request,
      );
      return yield* apsAuthToken(decoded);
    }
  }
});

const decodeTsOnlyRequest = Effect.fnUntraced(function* <A>(
  key: TsOnlyOperationKey,
  schema: Schema.Codec<A>,
  request: unknown,
) {
  return yield* Schema.decodeUnknownEffect(schema)(request ?? {}).pipe(
    Effect.mapError((error) => new InvalidHostRequest(key, error.message)),
  );
});

const validateTsOnlyNoRequest = Effect.fnUntraced(function* (
  key: TsOnlyOperationKey,
  request: unknown,
) {
  if (request == null || isEmptyRecord(request)) return;
  return yield* Effect.fail(
    new InvalidHostRequest(key, "operation does not accept a request payload"),
  );
});

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

type HostRpcSourceError =
  | BridgeError
  | Error
  | InvalidHostRequest
  | InvalidHostResponse
  | LocalOpError
  | NoRevitSession;

function mapHostRpcError<A, E extends HostRpcSourceError, R>(
  key: string,
  effect: Effect.Effect<A, E, R>,
) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new HostRpcError({
          key,
          kind: hostRpcKind(error),
          message: error.message,
          status: hostRpcStatus(error),
        }),
    ),
  );
}

function hostRpcKind(error: HostRpcSourceError): HostErrorKind {
  if (error instanceof Error) return "HostFailure";
  switch (error._tag) {
    case "InvalidHostRequest":
      return "InvalidRequest";
    case "NoRevitSession":
      return "Disconnected";
    case "BridgeError":
      return error.statusCode === 423
        ? "BridgeBusy"
        : error.statusCode === 503
          ? "Disconnected"
          : "HostFailure";
    case "InvalidHostResponse":
    case "LocalOpError":
      return "HostFailure";
    default:
      return "HostFailure";
  }
}

function hostRpcStatus(error: HostRpcSourceError): number {
  if (error instanceof Error) return 500;
  switch (error._tag) {
    case "InvalidHostRequest":
      return 400;
    case "InvalidHostResponse":
      return 500;
    case "LocalOpError":
      return localOpHttpStatus(error);
    case "NoRevitSession":
      return 503;
    case "BridgeError":
      return error.statusCode;
  }
}
