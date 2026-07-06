import { expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import {
  bridgeFrameSchema,
  bridgeRegistrationRequestSchema,
} from "@pe/host-contracts/contracts";
import { hostOpKeys } from "@pe/host-contracts/generated";
import {
  bridgeSessionsListSchema,
  HostCallError,
  hostProblemDetailsSchema,
  hostSessionScopeSchema,
  isAnyOperationKey,
  isHostOperationKey,
  tsOnlyOperationSchemas,
  type HostOpRequest,
  type HostOpResponse,
} from "@pe/host-contracts/operation-types";
import { Schema } from "effect";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  exports?: Record<string, unknown>;
};

test("checked-in typegen keys cover bridge ops and exclude TS-only ops", () => {
  const keys = new Set<string>(hostOpKeys);
  expect(keys.has("revit.catalog.loaded-families")).toBe(true);
  expect(keys.has("host.ops.catalog")).toBe(true);
  expect(keys.has("scripting.execute")).toBe(true);
  expect(keys.has("host.status")).toBe(false);
  expect(keys.has("logs.tail")).toBe(false);
  expect(keys.has("settings.workspaces")).toBe(false);
  expect(keys.has("aps.auth.status")).toBe(false);
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

test("exports operation key guards", () => {
  expect(isAnyOperationKey("revit.catalog.loaded-families")).toBe(true);
  expect(isAnyOperationKey("missing.operation")).toBe(false);
  expect(isHostOperationKey("revit.catalog.loaded-families")).toBe(true);
  expect(isHostOperationKey("host.status")).toBe(false);
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

test("key guards agree with the checked-in typegen key list", () => {
  for (const key of hostOpKeys) {
    expect(isHostOperationKey(key)).toBe(true);
    expect(isAnyOperationKey(key)).toBe(true);
  }
});

test("settings open-with-module schema decodes C# module/schema context", () => {
  const decoded = Schema.decodeUnknownSync(
    tsOnlyOperationSchemas["settings.document.open-with-module"].request,
  )({
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
  });

  expect(decoded.module.moduleKey).toBe("CmdScheduleManager");
  expect(decoded.module.storageOptions?.includeRoots).toEqual(["fragments"]);
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
