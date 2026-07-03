import { expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import {
  bridgeFrameSchema,
  bridgeRegistrationRequestSchema,
  hostOperations,
} from "@pe/host-contracts/contracts";
import { hostEffectOperationSchemas } from "@pe/host-contracts/effect/registry";
import {
  bridgeSessionsListSchema,
  HostCallError,
  anyOperationKeySchema,
  hostProblemDetailsSchema,
  hostSessionScopeSchema,
  isAnyOperationKey,
  isHostOperationKey,
  tsOnlyOperationSchemas,
  toHostCallError,
  type HostOpRequest,
  type HostOpResponse,
} from "@pe/host-contracts/operation-types";
import { Schema } from "effect";
import { HostRpcs } from "@pe/host-contracts/rpc";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  exports?: Record<string, unknown>;
};

test("exports generated host operation contracts", () => {
  expect(Object.hasOwn(hostOperations, "host.status")).toBe(false);
  expect(Object.hasOwn(hostOperations, "logs.tail")).toBe(false);
  expect(Object.hasOwn(hostOperations, "settings.document.validate")).toBe(false);
  expect(Object.hasOwn(hostOperations, "settings.workspaces")).toBe(false);
  expect(Object.hasOwn(hostOperations, "revit.catalog.recent-documents")).toBe(false);
  expect(Object.hasOwn(hostOperations, "aps.auth.status")).toBe(false);
  expect(hostOperations["revit.catalog.loaded-families"].key).toBe("revit.catalog.loaded-families");
});

test("does not ship the legacy plain TypeGen DTO projection", () => {
  expect(existsSync(new URL("../src/types", import.meta.url))).toBe(false);
  expect(Object.hasOwn(packageJson.exports ?? {}, "./types")).toBe(false);
});

test("exports generic operation request and response typing", () => {
  const noRequest = {} satisfies HostOpRequest<"host.status">;
  const recentDocumentsRequest = {
    includeRegistryMru: true,
    localFilesOnly: false,
    revitYear: "2025",
  } satisfies HostOpRequest<"revit.catalog.recent-documents">;
  const status = {
    bridgeContractVersion: 0,
    bridgeIsConnected: false,
    bridgePath: "/api/bridge",
    disconnectReason: null,
    hostContractVersion: 0,
    runtimeIdentity: "test",
  } satisfies HostOpResponse<"host.status">;
  expect(noRequest).toEqual({});
  expect(recentDocumentsRequest.revitYear).toBe("2025");
  expect(status.bridgeIsConnected).toBe(false);
  expect(new HostCallError("failed", 500)).toBeInstanceOf(HostCallError);
  expect(
    toHostCallError("host.status", {
      _tag: "HostRpcError",
      key: "host.status",
      kind: "BridgeBusy",
      message: "failed",
      status: 500,
    }),
  ).toBeInstanceOf(HostCallError);
  expect(
    toHostCallError("host.status", {
      _tag: "HostRpcError",
      key: "host.status",
      kind: "BridgeBusy",
      message: "failed",
      status: 423,
    })?.problem?.kind,
  ).toBe("BridgeBusy");
  const mismatched = toHostCallError("caller.key", {
    _tag: "HostRpcError",
    key: "server.key",
    kind: "BridgeBusy",
    message: "failed",
    status: 423,
  });
  expect(mismatched?.problem?.operationKey).toBe("server.key");
  expect(mismatched?.message).toBe("server.key: failed");
});

test("exports TS-owned bridge session list schema", () => {
  const decoded = Schema.decodeUnknownSync(bridgeSessionsListSchema)({
    sessions: [{ connected: true, openDocumentCount: 1, sessionId: "bridge-a" }],
  });
  expect(decoded.sessions[0]?.sessionId).toBe("bridge-a");
});

test("exports generic caller session scope as a schema-derived shape", () => {
  const decoded = Schema.decodeUnknownSync(hostSessionScopeSchema)({
    bridgeSessionId: "bridge-a",
    ignored: true,
  });
  expect(decoded).toEqual({ bridgeSessionId: "bridge-a" });
});

test("exports host problem details as a schema-derived loose record", () => {
  const decoded = Schema.decodeUnknownSync(hostProblemDetailsSchema)({
    kind: "BridgeBusy",
    operationKey: "host.status",
    status: 423,
  });
  expect(decoded.kind).toBe("BridgeBusy");
});

test("exports generic operation key schema", () => {
  expect(Schema.decodeUnknownSync(anyOperationKeySchema)("host.status")).toBe("host.status");
  expect(Schema.decodeUnknownSync(anyOperationKeySchema)("revit.catalog.loaded-families")).toBe(
    "revit.catalog.loaded-families",
  );
  expect(Schema.decodeUnknownSync(anyOperationKeySchema)("settings.tree")).toBe("settings.tree");
  expect(Schema.decodeUnknownSync(anyOperationKeySchema)("aps.auth.status")).toBe(
    "aps.auth.status",
  );
  expect(isAnyOperationKey("revit.catalog.loaded-families")).toBe(true);
  expect(isAnyOperationKey("missing.operation")).toBe(false);
  expect(isHostOperationKey("revit.catalog.loaded-families")).toBe(true);
  expect(isHostOperationKey("host.status")).toBe(false);
  expect(() => Schema.decodeUnknownSync(anyOperationKeySchema)("missing.operation")).toThrow();
});

test("exports generated Effect bridge frame schema", () => {
  const decoded = Schema.decodeUnknownSync(bridgeFrameSchema)({
    kind: "Event",
    event: { eventName: "ready", payloadJson: "{}" },
  });
  expect(decoded.event?.eventName).toBe("ready");
});

test("keeps bridge session ids host-owned", () => {
  const decoded = Schema.decodeUnknownSync(bridgeRegistrationRequestSchema)({
    contractVersion: 19,
    processId: 123,
    sessionId: "revit-owned-session-id",
    state: {
      activeDocumentCloudModelGuid: null,
      activeDocumentCloudModelUrn: null,
      activeDocumentCloudProjectGuid: null,
      activeDocumentIsFamilyDocument: false,
      activeDocumentIsModelInCloud: false,
      activeDocumentIsWorkshared: false,
      activeDocumentKey: null,
      activeDocumentObservedAtUnixMs: 0,
      activeDocumentPath: null,
      activeDocumentTitle: null,
      availableModules: [],
      hasActiveDocument: false,
      openDocumentCount: 0,
      revitVersion: "2025",
      runtimeAssemblies: [],
      runtimeFramework: ".NET",
      sharedParametersFilename: null,
    },
  });

  expect(Object.hasOwn(decoded, "sessionId")).toBe(false);
});

test("exports generated Effect operation schema registry", () => {
  const decoded = Schema.decodeUnknownSync(
    hostEffectOperationSchemas["revit.catalog.loaded-families"].request!,
  )({});
  expect(decoded).toEqual({});
});

test("keeps generated bridge operation metadata and Effect schemas key-aligned", () => {
  expect(Object.keys(hostEffectOperationSchemas).sort()).toEqual(
    Object.keys(hostOperations).sort(),
  );
});

test("exports generated bridge operations as direct RPC members", () => {
  expect(HostRpcs.requests.has("host.call")).toBe(true);
  expect(HostRpcs.requests.has("revit.catalog.loaded-families")).toBe(true);
});

test("host.call accepts every public operation key", () => {
  const hostCall = HostRpcs.requests.get("host.call");
  const payloadSchema = hostCall?.payloadSchema;
  expect(payloadSchema).toBeDefined();
  if (!payloadSchema) throw new Error("missing host.call payload schema");

  const decode = (payload: unknown) =>
    Schema.decodeUnknownSync(payloadSchema)(payload) as { readonly key: string };
  expect(decode({ key: "host.status" }).key).toBe("host.status");
  expect(decode({ key: "settings.tree", request: {} }).key).toBe("settings.tree");
  expect(
    Object.hasOwn(decode({ key: "host.status", bridgeSessionId: "bridge-a" }), "bridgeSessionId"),
  ).toBe(false);
  expect(decode({ key: "revit.catalog.loaded-families", request: {} }).key).toBe(
    "revit.catalog.loaded-families",
  );
});

test("exports direct settings open RPC for C# module/schema context", () => {
  const openWithModule = HostRpcs.requests.get("settings.document.open-with-module");
  const payloadSchema = openWithModule?.payloadSchema;
  expect(payloadSchema).toBeDefined();
  if (!payloadSchema) throw new Error("missing settings.document.open-with-module payload schema");

  const decoded = Schema.decodeUnknownSync(payloadSchema)({
    module: {
      defaultRootKey: "profiles",
      moduleKey: "CmdScheduleManager",
      roots: [{ displayName: "profiles", rootKey: "profiles" }],
      storageOptions: { includeRoots: ["fragments"], presetRoots: ["presets"] },
    },
    request: {
      documentId: {
        moduleKey: "CmdScheduleManager",
        relativePath: "main.json",
        rootKey: "profiles",
        stableId: "CmdScheduleManager:profiles:main.json",
      },
      includeComposedContent: true,
    },
    schemaJson: "{}",
  }) as {
    readonly module: {
      readonly moduleKey: string;
      readonly storageOptions?: { readonly includeRoots?: readonly string[] };
    };
  };

  expect(decoded.module.moduleKey).toBe("CmdScheduleManager");
  expect(decoded.module.storageOptions?.includeRoots).toEqual(["fragments"]);
});

test("exports every public generated bridge operation as a direct RPC member", () => {
  for (const key of Object.keys(hostOperations)) {
    expect(HostRpcs.requests.has(key)).toBe(true);
  }
  expect(HostRpcs.requests.has("settings.module-catalog")).toBe(false);
});

test("exports TS-only admin operation schemas", () => {
  const decoded = Schema.decodeUnknownSync(tsOnlyOperationSchemas["host.status"].response)({
    bridgeContractVersion: 19,
    bridgeIsConnected: false,
    bridgePath: "/api/bridge",
    disconnectReason: null,
    hostContractVersion: 34,
    runtimeIdentity: "test",
  });
  expect(decoded.bridgeIsConnected).toBe(false);

  const aps = Schema.decodeUnknownSync(tsOnlyOperationSchemas["aps.auth.logout"].response)({
    loggedOut: true,
  });
  expect(aps.loggedOut).toBe(true);

  const settingsTree = Schema.decodeUnknownSync(tsOnlyOperationSchemas["settings.tree"].request!)({
    includeFragments: true,
    moduleKey: "CmdScheduleManager",
    rootKey: "schedules",
  });
  expect(settingsTree.moduleKey).toBe("CmdScheduleManager");
});
