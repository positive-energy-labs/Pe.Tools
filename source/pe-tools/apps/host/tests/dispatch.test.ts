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
  type BridgeSessionView,
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
  listBridgeSessions,
  openShellPath,
} from "../src/local-ops.ts";
import { LocalOpError } from "../src/local-error.ts";
import {
  discoverSettingsTree,
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
      return Effect.succeed({
        value: { schemaJson: "{}" },
        target: { session: "bridge-b", document: null },
      });
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

test("host shell open validates an absolute existing path and returns the launched path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pe-shell-open-"));
  let launchedPath: string | undefined;
  try {
    const result = await runDispatch(
      openShellPath({ path: directory }, async (path) => {
        launchedPath = path;
      }),
    );
    expect(result).toEqual({ opened: true, path: directory });
    expect(launchedPath).toBe(directory);
    await expect(
      runDispatch(openShellPath({ path: "relative/path" }, async () => {})),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      runDispatch(openShellPath({ path: join(directory, "missing") }, async () => {})),
    ).rejects.toMatchObject({ statusCode: 404 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
        expected: { kind: "missing" },
        documentId: {
          moduleKey: "Global",
          rootKey: "fragments",
          relativePath: "hash-test",
        },
        rawContent: '{"ok":true}',
      }),
    );

    expect(result.kind).toBe("written");
    if (result.kind !== "written") throw new Error("expected write");
    expect(result.snapshot.metadata.versionToken?.value).toBe(sha256('{"ok":true}'));
  } finally {
    profile.dispose();
  }
});

test("settings save writes schema-invalid documents and returns validation issues", async () => {
  const profile = withTempUserProfile();
  const seen: string[] = [];
  try {
    const result = await runDispatch(
      saveSettingsDocument(
        {
          expected: { kind: "missing" },
          documentId: {
            moduleKey: "customer-library",
            rootKey: "settings",
            relativePath: "invalid-but-saved.schedule.json",
          },
          rawContent:
            '{"$schema":"http://localhost/schemas/settings/CmdScheduleManager/schedules.json"}',
        },
        {
          invokeBridge: (operationKey, payload) => {
            seen.push(operationKey);
            if (operationKey === "settings.schema")
              expect(payload).toEqual({ moduleKey: "CmdScheduleManager", rootKey: "schedules" });
            if (operationKey === "settings.module-catalog")
              throw new Error("Pod folder names are not registered library module names.");
            return Effect.succeed({
              schemaJson:
                '{"type":"object","required":["Name"],"properties":{"Name":{"type":"string"}}}',
            });
          },
        },
      ),
    );

    expect(result.kind).toBe("written");
    if (result.kind !== "written") throw new Error("expected write");
    expect(seen).not.toContain("settings.module-catalog");
    expect(result.snapshot.validation.isValid).toBe(false);
    expect(result.snapshot.validation.issues.some((issue) => issue.code === "required")).toBe(true);
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
          rawContent:
            '{"$schema":"http://localhost/schemas/settings/CmdScheduleManager/schedules.json"}',
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

test("settings create-only save refuses to overwrite an existing document", async () => {
  const profile = withTempUserProfile();
  try {
    const request = {
      documentId: {
        moduleKey: "Global",
        rootKey: "fragments",
        relativePath: "create-only",
      },
      rawContent: '{"version":1}',
      expected: { kind: "missing" as const },
    };
    expect((await runDispatch(saveSettingsDocument(request))).kind).toBe("written");

    const conflict = await runDispatch(
      saveSettingsDocument({ ...request, rawContent: '{"version":2}' }),
    );
    expect(conflict.kind).toBe("conflict");
  } finally {
    profile.dispose();
  }
});

test("settings validation merges registered semantic diagnostics after structural validation", async () => {
  const result = await runDispatch(
    validateSettingsDocument(
      {
        documentId: {
          moduleKey: "FamilyFoundry",
          rootKey: "models",
          relativePath: "showcase",
        },
        rawContent:
          '{"$schema":"http://localhost/schemas/settings/FamilyFoundry/models.json","family":{"name":"Showcase"}}',
      },
      {
        invokeBridge: (operationKey) => {
          if (operationKey === "settings.module-catalog")
            return Effect.succeed({
              modules: [
                {
                  moduleKey: "FamilyFoundry",
                  defaultRootKey: "models",
                  roots: [{ rootKey: "models", displayName: "Family Models" }],
                  storageOptions: { includeRoots: [], presetRoots: [] },
                },
              ],
            });
          if (operationKey === "settings.schema")
            return Effect.succeed({ schemaJson: '{"type":"object"}' });
          return Effect.succeed({
            isConfigured: true,
            issues: [
              {
                instancePath: "$.solids.body.frame",
                schemaPath: null,
                code: "unsupported-frame",
                severity: "error",
                message: "Frame is not declared.",
                suggestion: null,
              },
            ],
          });
        },
      },
    ),
  );

  expect(result.isValid).toBe(false);
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: "unsupported-frame",
      path: "$.solids.body.frame",
    }),
  );
});

test("settings workspaces are discovered from local pods without consulting Revit", async () => {
  const profile = withTempUserProfile();
  const seen: unknown[] = [];
  try {
    mkdirSync(join(profile.path, "Documents", "Pe.Tools", "Pods", "family-library", "settings"), {
      recursive: true,
    });
    writeFileSync(
      join(profile.path, "Documents", "Pe.Tools", "Pods", "family-library", "pod.json"),
      "{}",
    );
    mkdirSync(join(profile.path, "Documents", "Pe.Tools", "Pods", "script-only", "src"), {
      recursive: true,
    });
    writeFileSync(
      join(profile.path, "Documents", "Pe.Tools", "Pods", "script-only", "pod.json"),
      "{}",
    );
    mkdirSync(join(profile.path, "Documents", "Pe.Tools", "Pods", "manifestless", "settings"), {
      recursive: true,
    });
    const result = await runDispatch(
      getSettingsWorkspaces({
        bridge: { connected: true },
        invokeBridge: (operationKey, payload) => {
          seen.push({ operationKey, payload });
          return Effect.succeed({ modules: [] });
        },
      }),
    );

    expect(seen).toEqual([]);
    expect(result.workspaces).toEqual([
      {
        workspaceKey: "pods",
        displayName: "Pods",
        basePath: join(profile.path, "Documents", "Pe.Tools", "Pods"),
        modules: [
          {
            moduleKey: "family-library",
            defaultRootKey: "settings",
            roots: [{ rootKey: "settings", displayName: "settings" }],
          },
        ],
      },
    ]);
  } finally {
    profile.dispose();
  }
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
  const bridge = {
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
      openDocuments: [
        {
          openId: "project",
          title: "Model",
          address: "C:/model.rvt",
          isFamilyDocument: false,
          isActive: true,
        },
        {
          openId: "family",
          title: "Unsaved family",
          address: null,
          isFamilyDocument: true,
          isActive: false,
        },
        {
          openId: "cloud",
          title: "Cloud",
          address: "f2933e8d-9e16-4bf4-b9ca-484f461e4563",
          isFamilyDocument: false,
          isActive: false,
        },
      ],
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
  } satisfies BridgeSessionView;
  const summary = await Effect.runPromise(getBridgeSessionSummary(bridge));
  const inventory = await Effect.runPromise(listBridgeSessions(Effect.succeed([bridge])));
  expect(inventory.sessions[0]?.openDocuments).toEqual(bridge.state.openDocuments);
  expect(inventory.sessions[0]?.openDocumentCount).toBe(3);

  expect(summary.activeDocument?.key).toBe("doc-key");
  expect(summary.availableModules).toHaveLength(1);
  expect(summary.runtimeAssemblies).toHaveLength(1);
  expect(summary.workbenchResources.parameters.sharedParametersFile).toMatchObject({
    exists: true,
    path: "C:/shared.txt",
    provenance: "revit-state-sync",
  });
});

test("bridge sessions list carries process-start identity", async () => {
  const result = await Effect.runPromise(
    listBridgeSessions(
      Effect.succeed([
        {
          connected: true,
          sessionId: "bridge-a",
          processId: 123,
          processStartUtcUnixMs: 1_752_000_000_000,
        },
      ]),
    ),
  );

  expect(result.sessions).toEqual([
    expect.objectContaining({
      sessionId: "bridge-a",
      processId: 123,
      processStartUtcUnixMs: 1_752_000_000_000,
    }),
  ]);
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
      openDocuments: [],
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
      openDocuments: [],
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
