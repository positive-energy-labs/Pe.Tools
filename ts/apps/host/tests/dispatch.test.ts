import { Deferred, Effect, FileSystem, Ref } from "effect";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import type { HttpClient } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import type { BridgeResponse } from "@pe/host-contracts/contracts";
import { BRIDGE_CONTRACT_VERSION } from "@pe/host-contracts/contracts";
import {
  BridgeError,
  completeBridgeRequest,
  getBridgeRegistrationRejection,
  trackBridgeRequest,
  type BridgeRequest,
  type RevitBridge,
  type BridgeSessionView,
} from "../src/bridge.ts";
import { dispatchTsOnlyOperation, InvalidHostRequest } from "../src/call-route.ts";
import {
  createApsTokenStoreKey,
  normalizeApsTokenRequest,
  resolveApsScopes,
} from "../src/aps-auth.ts";
import { getBridgeSessionSummary, listBridgeSessions, openShellPath } from "../src/local-ops.ts";
import { productPodsRootPath } from "../src/product-paths.ts";

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

test("pod compose runs schema-only when the selected session is disconnected", async () => {
  const seen: string[] = [];
  const bridge = {
    invoke: (key: string) => {
      seen.push(`invoke:${key}`);
      return Effect.succeed({ value: {} });
    },
    snapshot: (bridgeSessionId?: string) => {
      seen.push(`snapshot:${bridgeSessionId ?? ""}`);
      return Effect.succeed({ connected: false });
    },
    list: Effect.succeed([]),
  } as unknown as RevitBridge["Service"];
  const profile = withTempUserProfile();
  try {
    const podDir = join(productPodsRootPath(), "P");
    mkdirSync(podDir, { recursive: true });
    writeFileSync(join(podDir, "pod.json"), '{"id":"p"}');
    const result = await runDispatch(
      dispatchTsOnlyOperation(
        "pod.member.compose",
        { pod: "p", path: "settings/x.json", content: '{"$include":"@local/y"}' },
        "bridge-b",
        bridge,
      ),
    );
    expect(seen).toEqual(["snapshot:bridge-b"]);
    expect(result).toMatchObject({ composed: null, schemaValidation: "no-schema" });
  } finally {
    profile.dispose();
  }
});

test("ts-only dispatch rejects malformed requests before running the operation", async () => {
  const bridge = {
    invoke: () => Effect.succeed({}),
    snapshot: () => Effect.succeed({ connected: false }),
    list: Effect.succeed([]),
  } as unknown as RevitBridge["Service"];

  await expect(
    runDispatch(dispatchTsOnlyOperation("pod.member.read", { pod: 123 }, undefined, bridge)),
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

test("the request table routes each response to the request that carries its id", async () => {
  const [first, second, stale] = await Effect.runPromise(
    Effect.gen(function* () {
      const requests = yield* Ref.make<ReadonlyMap<string, BridgeRequest>>(new Map());
      const reply = yield* Deferred.make<BridgeResponse, BridgeError>();
      const other = yield* Deferred.make<BridgeResponse, BridgeError>();
      // Two live at once is a VALID state now: the FIFO gate keeps ordinary ops serial, and
      // `op.cancel` is dispatched beside the op it names.
      yield* trackBridgeRequest(requests, {
        operationKey: "first.operation",
        requestId: "request-1",
        reply,
        phase: "dispatched",
      });
      yield* trackBridgeRequest(requests, {
        operationKey: "op.cancel",
        requestId: "request-2",
        reply: other,
        phase: "dispatched",
      });
      const answer = (requestId: string) => ({
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
        requestId,
      });
      return [
        yield* completeBridgeRequest(requests, answer("request-1")),
        yield* completeBridgeRequest(requests, answer("request-2")),
        yield* completeBridgeRequest(requests, answer("stale-request")),
      ] as const;
    }),
  );

  expect([first, second, stale]).toEqual([true, true, false]);
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
