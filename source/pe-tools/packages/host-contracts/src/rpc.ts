import { Effect, Schema } from "effect";
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc";
import { HostRpcError } from "./rpc-error.js";
import {
  bridgeOperationRpcs,
  callBridgeOperationRpcMember,
} from "./effect/bridge-operation-rpcs.generated.js";
import {
  apsLogoutResultSchema,
  apsPersistedTokenStatusSchema,
  apsTokenRequestSchema,
  apsTokenResultSchema,
} from "./effect/host-effect.generated.js";
import {
  bridgeSessionsListSchema,
  anyOperationKeySchema,
  hostLogsDataSchema,
  hostLogsRequestSchema,
  hostProbeDataSchema,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  hostSessionSummaryDataSchema,
  isHostOperationKey,
  openSettingsDocumentRequestSchema,
  openSettingsDocumentWithModuleRequestSchema,
  revitRecentDocumentsDataSchema,
  revitRecentDocumentsRequestSchema,
  saveSettingsDocumentRequestSchema,
  saveSettingsDocumentResultSchema,
  settingsDiscoveryResultSchema,
  settingsDocumentSnapshotSchema,
  settingsTreeRequestSchema,
  settingsValidationResultSchema,
  settingsWorkspacesDataSchema,
  validateSettingsDocumentRequestSchema,
  type AnyOperationKey,
  type HostSessionScope,
} from "./operation-types.js";

export { HostRpcError } from "./rpc-error.js";
export { makeBridgeOperationRpcHandlers } from "./effect/bridge-operation-rpcs.generated.js";
export type { BridgeOperationRpcHandler } from "./effect/bridge-operation-rpcs.generated.js";

export class HostCall extends Rpc.make("host.call", {
  payload: {
    key: anyOperationKeySchema,
    request: Schema.optional(Schema.Unknown),
  },
  success: Schema.Unknown,
  error: HostRpcError,
}) {}

export class HostStatus extends Rpc.make("host.status", {
  payload: {},
  success: hostProbeDataSchema,
  error: HostRpcError,
}) {}

export class BridgeSessionsSummary extends Rpc.make("bridge.sessions.summary", {
  payload: {},
  success: hostSessionSummaryDataSchema,
  error: HostRpcError,
}) {}

export class BridgeSessionsList extends Rpc.make("bridge.sessions.list", {
  payload: {},
  success: bridgeSessionsListSchema,
  error: HostRpcError,
}) {}

export class LogsTail extends Rpc.make("logs.tail", {
  payload: hostLogsRequestSchema,
  success: hostLogsDataSchema,
  error: HostRpcError,
}) {}

export class SettingsWorkspaces extends Rpc.make("settings.workspaces", {
  payload: {},
  success: settingsWorkspacesDataSchema,
  error: HostRpcError,
}) {}

export class SettingsTree extends Rpc.make("settings.tree", {
  payload: settingsTreeRequestSchema,
  success: settingsDiscoveryResultSchema,
  error: HostRpcError,
}) {}

export class SettingsDocumentOpen extends Rpc.make("settings.document.open", {
  payload: openSettingsDocumentRequestSchema,
  success: settingsDocumentSnapshotSchema,
  error: HostRpcError,
}) {}

export class SettingsDocumentOpenWithModule extends Rpc.make("settings.document.open-with-module", {
  payload: openSettingsDocumentWithModuleRequestSchema,
  success: settingsDocumentSnapshotSchema,
  error: HostRpcError,
}) {}

export class SettingsDocumentValidate extends Rpc.make("settings.document.validate", {
  payload: validateSettingsDocumentRequestSchema,
  success: settingsValidationResultSchema,
  error: HostRpcError,
}) {}

export class SettingsDocumentSave extends Rpc.make("settings.document.save", {
  payload: saveSettingsDocumentRequestSchema,
  success: saveSettingsDocumentResultSchema,
  error: HostRpcError,
}) {}

export class RevitRecentDocuments extends Rpc.make("revit.catalog.recent-documents", {
  payload: revitRecentDocumentsRequestSchema,
  success: revitRecentDocumentsDataSchema,
  error: HostRpcError,
}) {}

export class ApsAuthStatus extends Rpc.make("aps.auth.status", {
  payload: apsTokenRequestSchema,
  success: apsPersistedTokenStatusSchema,
  error: HostRpcError,
}) {}

export class ApsAuthLogin extends Rpc.make("aps.auth.login", {
  payload: apsTokenRequestSchema,
  success: apsPersistedTokenStatusSchema,
  error: HostRpcError,
}) {}

export class ApsAuthLogout extends Rpc.make("aps.auth.logout", {
  payload: {},
  success: apsLogoutResultSchema,
  error: HostRpcError,
}) {}

export class ApsAuthToken extends Rpc.make("aps.auth.token", {
  payload: apsTokenRequestSchema,
  success: apsTokenResultSchema,
  error: HostRpcError,
}) {}

export const HostRpcs = RpcGroup.make(
  HostCall,
  ...bridgeOperationRpcs,
  HostStatus,
  BridgeSessionsSummary,
  BridgeSessionsList,
  LogsTail,
  SettingsWorkspaces,
  SettingsTree,
  SettingsDocumentOpen,
  SettingsDocumentOpenWithModule,
  SettingsDocumentValidate,
  SettingsDocumentSave,
  RevitRecentDocuments,
  ApsAuthStatus,
  ApsAuthLogin,
  ApsAuthLogout,
  ApsAuthToken,
);

export const callHostRpcMember = Effect.fnUntraced(function* (
  key: AnyOperationKey,
  request: unknown,
  scope?: HostSessionScope,
) {
  const bridgeSessionId = scope?.bridgeSessionId;
  const client = yield* RpcClient.make(HostRpcs, { flatten: true });
  const scopedOptions = rpcScopeOptions(bridgeSessionId);
  if (isHostOperationKey(key))
    return bridgeSessionId
      ? yield* client("host.call", { key, request }, scopedOptions)
      : yield* callBridgeOperationRpcMember(client, key, request);
  switch (key) {
    case "host.status":
      return yield* client("host.status", {}, scopedOptions);
    case "bridge.sessions.summary":
      return yield* client("bridge.sessions.summary", {}, scopedOptions);
    case "bridge.sessions.list":
      return yield* client("bridge.sessions.list", {});
    case "logs.tail":
      return yield* client("logs.tail", yield* decodeRpcPayload(hostLogsRequestSchema, request));
    case "settings.workspaces":
      return yield* client("settings.workspaces", {}, scopedOptions);
    case "settings.tree":
      return bridgeSessionId
        ? yield* client(
            "host.call",
            {
              key,
              request: yield* decodeRpcPayload(settingsTreeRequestSchema, request),
            },
            scopedOptions,
          )
        : yield* client(
            "settings.tree",
            yield* decodeRpcPayload(settingsTreeRequestSchema, request),
          );
    case "settings.document.open":
      return bridgeSessionId
        ? yield* client(
            "host.call",
            {
              key,
              request: yield* decodeRpcPayload(openSettingsDocumentRequestSchema, request),
            },
            scopedOptions,
          )
        : yield* client(
            "settings.document.open",
            yield* decodeRpcPayload(openSettingsDocumentRequestSchema, request),
          );
    case "settings.document.open-with-module":
      return yield* client(
        "settings.document.open-with-module",
        yield* decodeRpcPayload(openSettingsDocumentWithModuleRequestSchema, request),
      );
    case "settings.document.validate":
      return bridgeSessionId
        ? yield* client(
            "host.call",
            {
              key,
              request: yield* decodeRpcPayload(validateSettingsDocumentRequestSchema, request),
            },
            scopedOptions,
          )
        : yield* client(
            "settings.document.validate",
            yield* decodeRpcPayload(validateSettingsDocumentRequestSchema, request),
          );
    case "settings.document.save":
      return bridgeSessionId
        ? yield* client(
            "host.call",
            {
              key,
              request: yield* decodeRpcPayload(saveSettingsDocumentRequestSchema, request),
            },
            scopedOptions,
          )
        : yield* client(
            "settings.document.save",
            yield* decodeRpcPayload(saveSettingsDocumentRequestSchema, request),
          );
    case "revit.catalog.recent-documents":
      return yield* client(
        "revit.catalog.recent-documents",
        yield* decodeRpcPayload(revitRecentDocumentsRequestSchema, request),
      );
    case "aps.auth.status":
      return yield* client(
        "aps.auth.status",
        yield* decodeRpcPayload(apsTokenRequestSchema, request),
      );
    case "aps.auth.login":
      return yield* client(
        "aps.auth.login",
        yield* decodeRpcPayload(apsTokenRequestSchema, request),
      );
    case "aps.auth.logout":
      return yield* client("aps.auth.logout", {});
    case "aps.auth.token":
      return yield* client(
        "aps.auth.token",
        yield* decodeRpcPayload(apsTokenRequestSchema, request),
      );
  }
});

function decodeRpcPayload<A>(schema: Schema.Codec<A>, request: unknown) {
  return Schema.decodeUnknownEffect(schema)(request ?? {});
}

function rpcScopeOptions(bridgeSessionId: string | undefined) {
  return bridgeSessionId
    ? { headers: { [HOST_RPC_BRIDGE_SESSION_HEADER]: bridgeSessionId } }
    : undefined;
}
