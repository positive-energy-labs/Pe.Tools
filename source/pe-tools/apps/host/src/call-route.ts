import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { RevitBridge, BridgeError, NoRevitSession } from "./bridge.ts";
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
  isTsOnlyOperationKey,
  tsOnlyOperationSchemas,
  type TsOnlyOperationKey,
} from "@pe/host-contracts/operation-types";
import type { HostErrorKind } from "@pe/host-contracts/contracts";

/**
 * The entire browser/CLI-facing wire: POST /call { key, request? } → JSON.
 * TS-only ops dispatch locally; every other key passes through to the bridge
 * untouched — the Revit side owns validation, so runtime-registered ops need
 * zero host changes. Errors are problem-JSON with a real HTTP status.
 */
export const callRoute = HttpRouter.add("POST", "/call", (req) =>
  Effect.gen(function* () {
    const body = yield* req.json.pipe(Effect.mapError(() => invalidBody("unreadable JSON body")));
    if (!isRecord(body) || typeof body.key !== "string")
      return yield* Effect.fail(invalidBody("body must be { key: string, request?: object }"));
    const key = body.key;
    const request = "request" in body ? body.request : undefined;
    const bridgeSessionId = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim() || undefined;

    const bridge = yield* RevitBridge;
    const result = isTsOnlyOperationKey(key)
      ? yield* dispatchTsOnlyOperation(key, request, bridgeSessionId, bridge)
      : yield* bridge.invoke(key, request ?? {}, bridgeSessionId);
    return Response.jsonUnsafe(result ?? null);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        Response.jsonUnsafe(toProblem(error), {
          status: toProblem(error).status,
          headers: { "content-type": "application/problem+json" },
        }),
      ),
    ),
  ),
);

export class InvalidHostRequest {
  readonly _tag = "InvalidHostRequest";
  constructor(
    readonly key: string,
    readonly message: string,
  ) {}
}

function invalidBody(message: string) {
  return new InvalidHostRequest("host.call", message);
}

export const dispatchTsOnlyOperation = Effect.fnUntraced(function* (
  key: TsOnlyOperationKey,
  request: unknown,
  bridgeSessionId: string | undefined,
  bridge: RevitBridge["Service"],
) {
  switch (key) {
    case "host.status":
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getHostStatus);
    case "bridge.sessions.summary":
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getBridgeSessionSummary);
    case "bridge.sessions.list":
      return yield* listBridgeSessions(bridge.list);
    case "logs.tail":
      return yield* tailLogs(yield* decodeRequest(key, request));
    case "settings.workspaces": {
      const bridgeView = yield* bridge.snapshot(bridgeSessionId);
      return yield* getSettingsWorkspaces({
        bridge: bridgeView,
        invokeBridge: (operationKey, payload) =>
          bridge.invoke(operationKey, payload, bridgeSessionId),
      });
    }
    case "settings.tree":
      return yield* discoverSettingsTree(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "settings.document.open":
      return yield* openSettingsDocument(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "settings.document.open-with-module": {
      const decoded = yield* decodeRequest(key, request);
      return yield* openSettingsDocumentWithModule(decoded.request, decoded.module, {
        schemaJson: decoded.schemaJson,
      });
    }
    case "settings.document.validate":
      return yield* validateSettingsDocument(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "settings.document.save":
      return yield* saveSettingsDocument(yield* decodeRequest(key, request), {
        bridgeSessionId,
        invokeBridge: (operationKey, payload, scopedBridgeSessionId) =>
          bridge.invoke(operationKey, payload, scopedBridgeSessionId),
      });
    case "revit.catalog.recent-documents":
      return yield* collectRecentDocuments(yield* decodeRequest(key, request));
    case "aps.auth.status":
      return yield* apsAuthStatus(yield* decodeRequest(key, request));
    case "aps.auth.login":
      return yield* apsAuthLogin(yield* decodeRequest(key, request));
    case "aps.auth.logout":
      return yield* apsAuthLogout();
    case "aps.auth.token":
      return yield* apsAuthToken(yield* decodeRequest(key, request));
  }
});

type RequestSchemaOf<K extends TsOnlyOperationKey> = (typeof tsOnlyOperationSchemas)[K] extends {
  readonly request: infer S extends Schema.Codec<any>;
}
  ? S
  : never;

const decodeRequest = Effect.fnUntraced(function* <K extends TsOnlyOperationKey>(
  key: K,
  request: unknown,
) {
  const schemas = tsOnlyOperationSchemas[key] as { request?: Schema.Codec<unknown> };
  if (!schemas.request) return {} as never;
  return (yield* Schema.decodeUnknownEffect(schemas.request)(request ?? {}).pipe(
    Effect.mapError((error) => new InvalidHostRequest(key, error.message)),
  )) as Schema.Schema.Type<RequestSchemaOf<K>>;
});

type CallError = BridgeError | Error | InvalidHostRequest | LocalOpError | NoRevitSession;

function toProblem(error: CallError): {
  kind: HostErrorKind;
  message: string;
  status: number;
} {
  if (error instanceof Error) return { kind: "HostFailure", message: error.message, status: 500 };
  switch (error._tag) {
    case "InvalidHostRequest":
      return { kind: "InvalidRequest", message: error.message, status: 400 };
    case "NoRevitSession":
      return { kind: "Disconnected", message: error.message, status: 503 };
    case "BridgeError":
      return {
        kind:
          error.statusCode === 423
            ? "BridgeBusy"
            : error.statusCode === 503
              ? "Disconnected"
              : "HostFailure",
        message: error.message,
        status: error.statusCode,
      };
    case "LocalOpError":
      return { kind: "HostFailure", message: error.message, status: localOpHttpStatus(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
