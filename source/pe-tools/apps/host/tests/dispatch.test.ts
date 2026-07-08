import { Deferred, Effect, FileSystem, Ref } from "effect";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import type { HttpClient } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import type { BridgeResponse } from "@pe/host-contracts/contracts";
import { BRIDGE_CONTRACT_VERSION } from "@pe/host-contracts/contracts";
import {
  BridgeError,
  completeBridgePending,
  getBridgeRegistrationRejection,
  reserveBridgePending,
  type RevitBridge,
} from "../src/bridge.ts";
import { dispatchTsOnlyOperation, InvalidHostRequest } from "../src/call-route.ts";
import {
  createApsTokenStoreKey,
  normalizeApsTokenRequest,
  resolveApsScopes,
} from "../src/aps-auth.ts";
import {
  getBridgeSessionSummary,
  getSettingsWorkspaces,
  parseRegistryRecentDocumentRows,
} from "../src/local-ops.ts";
import { LocalOpError } from "../src/local-error.ts";
import {
  discoverSettingsTree,
  openSettingsDocument,
  openSettingsDocumentWithModule,
  saveSettingsDocument,
  validateSettingsDocument,
} from "../src/settings.ts";

type BridgePendingRefValue =
  Parameters<typeof reserveBridgePending>[0] extends Ref.Ref<infer T> ? T : never;

function runDispatch<A, E>(
  effect: Effect.Effect<
    A,
    E,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient
  >,
) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
  );
}

test("dispatch threads bridgeSessionId through local snapshots and bridge invokes", async () => {
  const seen: string[] = [];
  const bridge = {
    invoke: (key: string, _payload: unknown, bridgeSessionId?: string) => {
      seen.push(`invoke:${key}:${bridgeSessionId ?? ""}`);
      return Effect.succeed({ schemaJson: "{}" });
    },
    snapshot: (bridgeSessionId?: string) => {
      seen.push(`snapshot:${bridgeSessionId ?? ""}`);
      return Effect.succeed({ connected: false });
    },
    list: Effect.succeed([]),
  } as unknown as RevitBridge["Service"];

  // ts-only ops thread the session id into local snapshots and bridge invokes.
  await runDispatch(dispatchTsOnlyOperation("settings.workspaces", undefined, "bridge-b", bridge));

  expect(seen[0]).toBe("snapshot:bridge-b");
});

test("ts-only dispatch rejects malformed requests before running the operation", async () => {
  const bridge = {
    invoke: () => Effect.succeed({}),
    snapshot: () => Effect.succeed({ connected: false }),
    list: Effect.succeed([]),
  } as unknown as RevitBridge["Service"];

  await expect(
    runDispatch(dispatchTsOnlyOperation("settings.tree", { moduleKey: 123 }, undefined, bridge)),
  ).rejects.toBeInstanceOf(InvalidHostRequest);
});

test("recent document registry parser reads Revit profile MRU values", () => {
  const rows = parseRegistryRecentDocumentRows(`
HKEY_CURRENT_USER\\Software\\Autodesk\\Revit\\Autodesk Revit 2025\\Profiles\\Default
    FileNameMRU1    REG_SZ    C:\\Models\\A.rvt
    OtherValue      REG_SZ    ignored
HKEY_CURRENT_USER\\Software\\Autodesk\\Revit\\Autodesk Revit 2024\\Profiles\\Design
    FileNameMRU2    REG_SZ    cld://project/model
`);

  expect(rows).toEqual([
    {
      path: "C:\\Models\\A.rvt",
      profile: "Default",
      revitYear: "2025",
      valueName: "FileNameMRU1",
    },
    {
      path: "cld://project/model",
      profile: "Design",
      revitYear: "2024",
      valueName: "FileNameMRU2",
    },
  ]);
});

test("settings tree path validation fails as LocalOpError", async () => {
  await expect(
    runDispatch(
      discoverSettingsTree({
        subDirectory: "C:\\outside",
      }),
    ),
  ).rejects.toBeInstanceOf(LocalOpError);
});

test("settings save uses content hash version tokens", async () => {
  const profile = withTempUserProfile();
  try {
    const result = await runDispatch(
      saveSettingsDocument({
        documentId: {
          moduleKey: "Global",
          rootKey: "fragments",
          relativePath: "hash-test",
        },
        rawContent: '{"ok":true}',
      }),
    );

    expect(result.writeApplied).toBe(true);
    expect(result.metadata.versionToken?.value).toBe(sha256('{"ok":true}\n'));
  } finally {
    profile.dispose();
  }
});

test("settings save writes schema-invalid documents and returns validation issues", async () => {
  const profile = withTempUserProfile();
  try {
    const result = await runDispatch(
      saveSettingsDocument(
        {
          documentId: {
            moduleKey: "CmdScheduleManager",
            rootKey: "schedules",
            relativePath: "profiles/invalid-but-saved",
          },
          rawContent: "{}",
        },
        {
          invokeBridge: (operationKey) =>
            Effect.succeed(
              operationKey === "settings.module-catalog"
                ? {
                    modules: [
                      {
                        moduleKey: "CmdScheduleManager",
                        defaultRootKey: "schedules",
                        roots: [{ rootKey: "schedules", displayName: "schedules" }],
                        storageOptions: { includeRoots: [], presetRoots: [] },
                      },
                    ],
                  }
                : {
                    schemaJson:
                      '{"type":"object","required":["Name"],"properties":{"Name":{"type":"string"}}}',
                  },
            ),
        },
      ),
    );

    expect(result.writeApplied).toBe(true);
    expect(result.validation.isValid).toBe(false);
    expect(result.validation.issues.some((issue) => issue.code === "required")).toBe(true);
  } finally {
    profile.dispose();
  }
});

test("settings open composes global includes from bridge-discovered module options", async () => {
  const profile = withTempUserProfile();
  try {
    const settingsRoot = join(profile.path, "Documents", "Pe.Tools", "settings");
    mkdirSync(join(settingsRoot, "Global", "fragments", "_fields"), { recursive: true });
    mkdirSync(join(settingsRoot, "CmdScheduleManager", "schedules", "profiles"), {
      recursive: true,
    });
    writeFileSync(
      join(settingsRoot, "Global", "fragments", "_fields", "shared.json"),
      '[{"Name":"Room"}]',
    );
    writeFileSync(
      join(settingsRoot, "CmdScheduleManager", "schedules", "profiles", "main.json"),
      '{"Fields":[{"$include":"@global/_fields/shared"}]}',
    );

    const snapshot = await runDispatch(
      openSettingsDocument(
        {
          documentId: {
            moduleKey: "CmdScheduleManager",
            rootKey: "schedules",
            relativePath: "profiles/main",
          },
          includeComposedContent: true,
        },
        {
          invokeBridge: (operationKey) =>
            Effect.succeed(
              operationKey === "settings.module-catalog"
                ? {
                    modules: [
                      {
                        moduleKey: "CmdScheduleManager",
                        defaultRootKey: "schedules",
                        roots: [{ rootKey: "schedules", displayName: "schedules" }],
                        storageOptions: { includeRoots: ["_fields"], presetRoots: [] },
                      },
                    ],
                  }
                : { schemaJson: "{}" },
            ),
        },
      ),
    );

    expect(snapshot.composedContent).toContain('"Name": "Room"');
    expect(snapshot.dependencies[0]).toMatchObject({
      directivePath: "@global/_fields/shared",
      scope: "Global",
      kind: "Include",
    });
  } finally {
    profile.dispose();
  }
});

test("settings open preserves missing document as not found", async () => {
  const profile = withTempUserProfile();
  try {
    await expect(
      runDispatch(
        openSettingsDocumentWithModule(
          {
            documentId: {
              moduleKey: "CmdScheduleManager",
              rootKey: "schedules",
              relativePath: "profiles/missing",
            },
            includeComposedContent: true,
          },
          {
            moduleKey: "CmdScheduleManager",
            defaultRootKey: "schedules",
            roots: [{ rootKey: "schedules", displayName: "schedules" }],
            storageOptions: { includeRoots: [], presetRoots: [] },
          },
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  } finally {
    profile.dispose();
  }
});

test("settings validation uses bridge schema json", async () => {
  const profile = withTempUserProfile();
  try {
    const result = await runDispatch(
      validateSettingsDocument(
        {
          documentId: {
            moduleKey: "CmdScheduleManager",
            rootKey: "schedules",
            relativePath: "profiles/main",
          },
          rawContent: "{}",
        },
        {
          invokeBridge: (operationKey) =>
            Effect.succeed(
              operationKey === "settings.module-catalog"
                ? {
                    modules: [
                      {
                        moduleKey: "CmdScheduleManager",
                        defaultRootKey: "schedules",
                        roots: [{ rootKey: "schedules", displayName: "schedules" }],
                        storageOptions: { includeRoots: [], presetRoots: [] },
                      },
                    ],
                  }
                : {
                    schemaJson:
                      '{"type":"object","required":["Name"],"properties":{"Name":{"type":"string"}}}',
                  },
            ),
        },
      ),
    );

    expect(result.isValid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "required")).toBe(true);
  } finally {
    profile.dispose();
  }
});

test("settings workspaces calls internal module catalog without fake payload", async () => {
  const seen: unknown[] = [];
  const result = await runDispatch(
    getSettingsWorkspaces({
      bridge: { connected: true },
      invokeBridge: (operationKey, payload) => {
        seen.push({ operationKey, payload });
        return Effect.succeed({ modules: [] });
      },
    }),
  );

  expect(seen).toEqual([{ operationKey: "settings.module-catalog", payload: undefined }]);
  expect(result.workspaces.length).toBe(1);
});

test("aps auth defaults preserve C# token-store key shape", () => {
  const request = normalizeApsTokenRequest({});
  expect(request.flowKind).toBe("ThreeLeggedConfidential");
  expect(request.scopeProfile).toBe("ParameterService");
  expect(resolveApsScopes(request)).toEqual([
    "account:read",
    "bucket:read",
    "code:all",
    "data:create",
    "data:read",
    "data:write",
  ]);
  expect(createApsTokenStoreKey("client-a", request)).toBe(
    "client-a|ThreeLeggedConfidential|account:read bucket:read code:all data:create data:read data:write",
  );
});

test("bridge pending mailbox rejects concurrent reservations", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const pending = yield* Ref.make<BridgePendingRefValue>(null);
      const first = yield* Deferred.make<BridgeResponse, BridgeError>();
      const second = yield* Deferred.make<BridgeResponse, BridgeError>();
      yield* reserveBridgePending(pending, "first.operation", "request-1", first);
      return yield* Effect.flip(
        reserveBridgePending(pending, "second.operation", "request-2", second),
      );
    }),
  );

  expect(error).toBeInstanceOf(BridgeError);
  expect(error.statusCode).toBe(423);
  expect(error.message).toContain("first.operation");
});

test("bridge pending mailbox ignores mismatched response ids", async () => {
  const completed = await Effect.runPromise(
    Effect.gen(function* () {
      const pending = yield* Ref.make<BridgePendingRefValue>(null);
      const reply = yield* Deferred.make<BridgeResponse, BridgeError>();
      yield* reserveBridgePending(pending, "first.operation", "request-1", reply);
      return yield* completeBridgePending(pending, {
        errorMessage: null,
        metrics: {
          requestBytes: 0,
          responseBytes: 0,
          revitExecutionMs: 0,
          roundTripMs: 0,
          serializationMs: 0,
        },
        ok: true,
        payloadJson: "{}",
        requestId: "stale-request",
      });
    }),
  );

  expect(completed).toBe(false);
});

test("bridge session summary maps Revit state snapshot fields", async () => {
  const summary = await Effect.runPromise(
    getBridgeSessionSummary({
      connected: true,
      processId: 123,
      sessionId: "bridge-a",
      state: {
        activeDocumentCloudModelGuid: "model-guid",
        activeDocumentCloudModelUrn: "model-urn",
        activeDocumentCloudProjectGuid: "project-guid",
        activeDocumentIsFamilyDocument: true,
        activeDocumentIsModelInCloud: true,
        activeDocumentIsWorkshared: true,
        activeDocumentKey: "doc-key",
        activeDocumentObservedAtUnixMs: 42,
        activeDocumentPath: "C:/model.rvt",
        activeDocumentTitle: "Model",
        availableModules: [
          {
            activeDocumentKind: "Any",
            defaultRootKey: "default",
            moduleKey: "module-a",
            scope: "Session",
          },
        ],
        hasActiveDocument: true,
        openDocumentCount: 2,
        revitVersion: "2026",
        runtimeAssemblies: [
          {
            informationalVersion: "1.2.3",
            location: "C:/Pe.dll",
            moduleVersionId: "mvid",
            name: "Pe.Test",
            version: "1.2.3.0",
          },
        ],
        runtimeFramework: ".NET 8",
        sharedParametersFilename: "C:/shared.txt",
      },
    }),
  );

  expect(summary.activeDocument?.key).toBe("doc-key");
  expect(summary.availableModules).toHaveLength(1);
  expect(summary.runtimeAssemblies).toHaveLength(1);
  expect(summary.workbenchResources.parameters.sharedParametersFile).toMatchObject({
    exists: true,
    path: "C:/shared.txt",
    provenance: "revit-state-sync",
  });
});

test("bridge registration rejects mismatched contract versions", () => {
  const rejection = getBridgeRegistrationRejection({
    contractVersion: BRIDGE_CONTRACT_VERSION + 1,
    processId: 123,
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

  expect(rejection).toContain(`Expected '${BRIDGE_CONTRACT_VERSION}'`);
});

test("bridge registration accepts current contract version without session id", () => {
  const rejection = getBridgeRegistrationRejection({
    contractVersion: BRIDGE_CONTRACT_VERSION,
    processId: 123,
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

  expect(rejection).toBeNull();
});

function withTempUserProfile() {
  const previousUserProfile = process.env.USERPROFILE;
  const previousDocumentsRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  const path = mkdtempSync(join(tmpdir(), "pe-settings-"));
  const documentsPath = join(path, "Documents");
  process.env.USERPROFILE = path;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = documentsPath;
  return {
    path,
    dispose: () => {
      process.env.USERPROFILE = previousUserProfile;
      process.env.PE_TOOLS_DOCUMENTS_ROOT = previousDocumentsRoot;
      rmSync(path, { recursive: true, force: true });
    },
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
