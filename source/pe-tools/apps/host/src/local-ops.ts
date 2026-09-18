import { spawn } from "node:child_process";
import { isAbsolute, join, normalize } from "node:path";
import { Effect, FileSystem } from "effect";
import {
  BRIDGE_CONTRACT_VERSION,
  BRIDGE_PATH,
  HOST_CONTRACT_VERSION,
  productIdentity,
  productPathNames,
} from "@pe/host-contracts/contracts";
import {
  HostLogTarget,
  type HostProbeData,
  type HostLogFileData,
  type HostLogsData,
  type HostLogsRequest,
  type HostShellOpenData,
  type HostShellOpenRequest,
  type HostSessionSummaryData,
} from "@pe/host-contracts/operation-types";
import type { BridgeSessionView } from "./bridge.ts";
import { readFileStringOrEmpty, statOrNull } from "./files/index.ts";
import { resolvePeaWorld, type PeaRuntimeCapabilities } from "@pe/runtime/pea";
import { hostCapabilities, hostOwnership } from "./host-ownership.ts";
import { LocalOpError } from "./local-error.ts";

const RUNTIME_IDENTITY = `pe-host-ts/${process.version}`;

export type AgentRuntimeStatus = { readonly available: boolean; readonly error: string | null };

// Mastra tenant health (D4). Starts unavailable/no-error ("not yet settled"); the tenant layer
// reports in once its init succeeds or degrades to 503 (mastra-runtime.ts catch).
let agentRuntimeStatus: AgentRuntimeStatus = { available: false, error: null };

export function setAgentRuntimeStatus(status: AgentRuntimeStatus): void {
  agentRuntimeStatus = status;
}

export function getHostStatus(
  bridge: BridgeSessionView,
  capabilities: PeaRuntimeCapabilities = hostCapabilities,
) {
  const world = resolvePeaWorld();
  return Effect.succeed({
    agentRuntime: agentRuntimeStatus,
    bridgeContractVersion: BRIDGE_CONTRACT_VERSION,
    bridgeIsConnected: bridge.connected,
    bridgePath: BRIDGE_PATH,
    capabilities,
    controllerId: "pea",
    disconnectReason: null,
    hostContractVersion: HOST_CONTRACT_VERSION,
    executablePath: hostOwnership.executablePath,
    lane: hostOwnership.lane,
    processId: hostOwnership.processId,
    resourceId: world.id,
    runtimeIdentity: RUNTIME_IDENTITY,
    serviceName: hostOwnership.serviceName,
    sourceRoot: hostOwnership.sourceRoot,
    world,
  } satisfies HostProbeData);
}

export function getBridgeSessionSummary(bridge: BridgeSessionView) {
  const s = bridge.state;
  const sharedParametersFilename = s?.sharedParametersFilename ?? null;
  return Effect.succeed({
    buildStamp: bridge.buildStamp ?? null,
    lane: bridge.lane ?? null,
    custody: bridge.custody ?? null,
    sdkSessionId: bridge.sdkSessionId ?? null,
    activeDocument:
      s?.hasActiveDocument === true
        ? {
            cloudModelGuid: s.activeDocumentCloudModelGuid ?? null,
            cloudModelUrn: s.activeDocumentCloudModelUrn ?? null,
            cloudProjectGuid: s.activeDocumentCloudProjectGuid ?? null,
            isFamilyDocument: s.activeDocumentIsFamilyDocument,
            isModelInCloud: s.activeDocumentIsModelInCloud,
            isWorkshared: s.activeDocumentIsWorkshared,
            key: s.activeDocumentKey ?? null,
            observedAtUnixMs: s.activeDocumentObservedAtUnixMs,
            path: s.activeDocumentPath ?? null,
            title: s.activeDocumentTitle ?? null,
          }
        : null,
    bridgeIsConnected: bridge.connected,
    openDocumentCount: s?.openDocuments.length ?? 0,
    processId: bridge.processId ?? null,
    revitVersion: s?.revitVersion ?? null,
    runtimeAssemblies: s?.runtimeAssemblies ?? [],
    runtimeFramework: s?.runtimeFramework ?? null,
    sessionId: bridge.sessionId ?? null,
    workbenchResources: {
      parameters: {
        globalStateDirectoryPath: "",
        parameterServiceCacheFiles: [],
        sharedParametersFile: {
          exists: Boolean(sharedParametersFilename),
          label: "Shared parameters file",
          path: sharedParametersFilename,
          provenance: sharedParametersFilename ? "revit-state-sync" : "unavailable",
        },
      },
    },
  } satisfies HostSessionSummaryData);
}

export const listBridgeSessions = Effect.fnUntraced(function* (
  bridges: Effect.Effect<readonly BridgeSessionView[]>,
) {
  const bridgeList = yield* bridges;
  return {
    sessions: bridgeList
      .filter((bridge) => bridge.connected && bridge.sessionId)
      .map((bridge) => ({
        activeDocumentCloudModelGuid: bridge.state?.activeDocumentCloudModelGuid ?? null,
        activeDocumentPath: bridge.state?.activeDocumentPath ?? null,
        activeDocumentTitle: bridge.state?.activeDocumentTitle ?? null,
        activeDocumentIsFamilyDocument: bridge.state?.activeDocumentIsFamilyDocument ?? null,
        // Observation time of the active-document facts — an observation, never computed staleness.
        activeDocumentObservedAtUnixMs: bridge.state?.activeDocumentObservedAtUnixMs ?? null,
        // Observed facts only: the lane/buildStamp the session reported. Never staleness.
        buildStamp: bridge.buildStamp ?? null,
        connected: true,
        lane: bridge.lane ?? null,
        openDocumentCount: bridge.state?.openDocuments.length ?? 0,
        openDocuments: bridge.state?.openDocuments ?? null,
        processId: bridge.processId ?? null,
        processStartUtcUnixMs: bridge.processStartUtcUnixMs ?? null,
        revitVersion: bridge.state?.revitVersion ?? null,
        runtimeFramework: bridge.state?.runtimeFramework ?? null,
        custody: bridge.custody ?? null,
        sdkSessionId: bridge.sdkSessionId ?? null,
        sessionId: bridge.sessionId!,
      })),
  };
});

export const tailLogs = Effect.fnUntraced(function* (input: HostLogsRequest) {
  const request = normalizeLogsRequest(input);
  const files = yield* readRequestedLogFiles(request);
  return { files } satisfies HostLogsData;
});

export const openShellPath = Effect.fnUntraced(function* (
  input: HostShellOpenRequest,
  launch: (path: string) => Promise<void> = launchWithDefaultHandler,
) {
  const requestedPath = input.path.trim();
  if (!requestedPath || !isAbsolute(requestedPath))
    return yield* Effect.fail(new LocalOpError("host.shell.open", "path must be absolute", 400));

  const path = normalize(requestedPath);
  if (!(yield* statOrNull(path, "host.shell.open")))
    return yield* Effect.fail(
      new LocalOpError("host.shell.open", `path does not exist: ${path}`, 404),
    );

  yield* Effect.tryPromise({
    try: () => launch(path),
    catch: (error) =>
      new LocalOpError("host.shell.open", `default handler failed for ${path}: ${String(error)}`),
  });
  return { opened: true, path } satisfies HostShellOpenData;
});

function launchWithDefaultHandler(path: string): Promise<void> {
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [path]]
      : process.platform === "darwin"
        ? ["open", [path]]
        : ["xdg-open", [path]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.removeAllListeners("error");
      child.unref();
      resolve();
    });
  });
}

function normalizeLogsRequest(input: HostLogsRequest): HostLogsRequest {
  return {
    target: input.target,
    tailLineCount: Math.max(Math.trunc(input.tailLineCount), 1),
  };
}

function readRequestedLogFiles(
  request: HostLogsRequest,
): Effect.Effect<HostLogFileData[], LocalOpError, FileSystem.FileSystem> {
  const logs = productLogPaths();
  switch (request.target) {
    case HostLogTarget.Host:
      return Effect.all([readLogFile("host", logs.hostLogPath, request.tailLineCount)]);
    case HostLogTarget.Revit:
      return Effect.all([readLogFile("revit", logs.revitAppLogPath, request.tailLineCount)]);
    case HostLogTarget.All:
      return Effect.all([
        readLogFile("host", logs.hostLogPath, request.tailLineCount),
        readLogFile("revit", logs.revitAppLogPath, request.tailLineCount),
      ]);
    default:
      return Effect.all([
        readLogFile("host", logs.hostLogPath, request.tailLineCount),
        readLogFile("revit", logs.revitAppLogPath, request.tailLineCount),
      ]);
  }
}

const readLogFile = Effect.fnUntraced(function* (
  label: string,
  filePath: string,
  tailLineCount: number,
) {
  const text = yield* readFileStringOrEmpty(filePath, "logs.tail");
  const lines = text ? splitLogLines(text) : [];
  return {
    label,
    filePath,
    lines: lines.slice(Math.max(0, lines.length - tailLineCount)),
  } satisfies HostLogFileData;
});

function splitLogLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function productLogPaths() {
  const rootPath = join(
    process.env.LOCALAPPDATA ?? "",
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.logsDirectoryName,
  );
  return {
    hostLogPath: join(rootPath, productPathNames.hostLogFileName),
    revitAppLogPath: join(rootPath, productPathNames.revitAppLogFileName),
  };
}
