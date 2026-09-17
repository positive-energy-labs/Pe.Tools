import { expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { bridgeFrameSchema, bridgeRegistrationRequestSchema } from "@pe/host-contracts/contracts";
import { hostOpKeys } from "@pe/host-contracts/generated";
import {
  bridgeSessionsListSchema,
  HostCallError,
  hostProblemDetailsSchema,
  hostSessionScopeSchema,
  isAnyOperationKey,
  isHostOperationKey,
  tsOnlyOperationCatalog,
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
const hostPeInfo = {
  capabilities: { revit: false },
  controllerId: "pea",
  resourceId: "pea:test",
  world: {
    id: "pea:test",
    root: "C:\\repo",
    storage: { kind: "local-unversioned" },
    isolation: "none",
  },
} as const;

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

test("host-local op catalog covers every TS-only op exactly once (GET /ops discovery)", () => {
  const catalogKeys = tsOnlyOperationCatalog.map((entry) => entry.key);
  const schemaKeys = Object.keys(tsOnlyOperationSchemas);
  expect(new Set(catalogKeys).size).toBe(catalogKeys.length); // no dupes
  expect(new Set(catalogKeys)).toEqual(new Set(schemaKeys)); // 1:1 with the schema map
  for (const entry of tsOnlyOperationCatalog) {
    expect(entry.origin).toBe("host-local"); // marks them for host-typegen to skip
    expect(entry.key in tsOnlyOperationSchemas).toBe(true);
  }
});

test("does not ship the legacy plain TypeGen DTO projection", () => {
  expect(existsSync(new URL("../src/types", import.meta.url))).toBe(false);
  expect(Object.hasOwn(packageJson.exports ?? {}, "./types")).toBe(false);
});

test("exports generic operation request and response typing", () => {
  const noRequest = {} satisfies HostOpRequest<"host.status">;
  const status = {
    ...hostPeInfo,
    bridgeContractVersion: 0,
    bridgeIsConnected: false,
    bridgePath: "/api/bridge",
    disconnectReason: null,
    hostContractVersion: 0,
    runtimeIdentity: "test",
    serviceName: "host",
  } satisfies HostOpResponse<"host.status">;
  expect(noRequest).toEqual({});
  expect(status.bridgeIsConnected).toBe(false);
  expect(new HostCallError("failed", 500)).toBeInstanceOf(HostCallError);
});

test("exports TS-owned bridge session list schema", () => {
  const decoded = Schema.decodeUnknownSync(bridgeSessionsListSchema)({
    sessions: [
      { connected: true, openDocumentCount: 1, openDocuments: null, sessionId: "bridge-a" },
    ],
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
      openDocuments: [],
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

test("pod member ops decode the member address and split create from save", () => {
  // The host decodes requests with excess properties refused; so does this check.
  const write = Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.write"].request, {
    onExcessProperty: "error",
  });
  expect(() =>
    write({ pod: "p", path: "settings/a.json", content: "{}", expectedSha256: "x" }),
  ).toThrow();
  const save = Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.save"].request);
  expect(() => save({ pod: "p", path: "settings/a.json", content: "{}" })).toThrow();
  expect(save({ pod: "p", path: "settings/a.json", content: "{}", expectedSha256: "x" })).toEqual({
    pod: "p",
    path: "settings/a.json",
    content: "{}",
    expectedSha256: "x",
  });
});

test("exports TS-only admin operation schemas", () => {
  const decoded = Schema.decodeUnknownSync(tsOnlyOperationSchemas["host.status"].response)({
    ...hostPeInfo,
    bridgeContractVersion: 19,
    bridgeIsConnected: false,
    bridgePath: "/api/bridge",
    disconnectReason: null,
    hostContractVersion: 34,
    runtimeIdentity: "test",
    serviceName: "host",
  });
  expect(decoded.bridgeIsConnected).toBe(false);

  const aps = Schema.decodeUnknownSync(tsOnlyOperationSchemas["aps.auth.logout"].response)({
    loggedOut: true,
  });
  expect(aps.loggedOut).toBe(true);

  const compose = Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.compose"].request)({
    pod: "pe-standards",
    path: "settings/schedules/a.json",
  });
  expect(compose.pod).toBe("pe-standards");

  const shellOpen = Schema.decodeUnknownSync(tsOnlyOperationSchemas["host.shell.open"].request)({
    path: "C:\\artifacts\\run",
  });
  const shellOpened = Schema.decodeUnknownSync(tsOnlyOperationSchemas["host.shell.open"].response)({
    opened: true,
    path: shellOpen.path,
  });
  expect(shellOpened).toEqual({ opened: true, path: "C:\\artifacts\\run" });
});
