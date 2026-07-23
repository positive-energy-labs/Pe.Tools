import { basename, join, win32 } from "node:path";
import { Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  BRIDGE_CONTRACT_VERSION,
  BRIDGE_PATH,
  HOST_CONTRACT_VERSION,
  productIdentity,
  productPathNames,
  revitDeploymentIdentity,
} from "@pe/host-contracts/contracts";
import {
  HostLogTarget,
  RevitRecentDocumentPathKind,
  RevitRecentDocumentSource,
  type HostProbeData,
  type HostLogFileData,
  type HostLogsData,
  type HostLogsRequest,
  type HostSessionSummaryData,
  type RevitRecentDocumentEntry,
  type RevitRecentDocumentsData,
  type RevitRecentDocumentsRequest,
  type SettingsModuleWorkspaceDescriptor,
  type SettingsWorkspaceDescriptor,
  type SettingsWorkspacesData,
} from "@pe/host-contracts/operation-types";
import type { BridgeSessionView } from "./bridge.ts";
import {
  readDirectoryEntriesOrEmpty,
  readFileStringBomAwareOrEmpty,
  readFileStringOrEmpty,
  statOrNull,
} from "./files/index.ts";
import { hostOwnership } from "./host-ownership.ts";
import { productSettingsRootPath } from "./product-paths.ts";
export {
  discoverSettingsTree,
  openSettingsDocument,
  openSettingsDocumentWithModule,
  saveSettingsDocument,
  validateSettingsDocument,
} from "./settings.ts";
import { LocalOpError } from "./local-error.ts";

const RUNTIME_IDENTITY = `pe-host-ts/${process.version}`;

export type AgentRuntimeStatus = { readonly available: boolean; readonly error: string | null };

// Mastra tenant health (D4). Starts unavailable/no-error ("not yet settled"); the tenant layer
// reports in once its init succeeds or degrades to 503 (mastra-runtime.ts catch).
let agentRuntimeStatus: AgentRuntimeStatus = { available: false, error: null };

export function setAgentRuntimeStatus(status: AgentRuntimeStatus): void {
  agentRuntimeStatus = status;
}

type LocalOpContext = {
  readonly bridge: BridgeSessionView;
  readonly invokeBridge: (
    operationKey: string,
    payload?: unknown,
  ) => Effect.Effect<unknown, unknown>;
};

type RecentDocumentsEffect = Effect.Effect<
  RevitRecentDocumentEntry[],
  LocalOpError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
>;

export function getHostStatus(bridge: BridgeSessionView) {
  return Effect.succeed({
    agentRuntime: agentRuntimeStatus,
    bridgeContractVersion: BRIDGE_CONTRACT_VERSION,
    bridgeIsConnected: bridge.connected,
    bridgePath: BRIDGE_PATH,
    disconnectReason: null,
    hostContractVersion: HOST_CONTRACT_VERSION,
    executablePath: hostOwnership.executablePath,
    lane: hostOwnership.lane,
    processId: hostOwnership.processId,
    runtimeIdentity: RUNTIME_IDENTITY,
    serviceName: hostOwnership.serviceName,
    sourceRoot: hostOwnership.sourceRoot,
  } satisfies HostProbeData);
}

export function getBridgeSessionSummary(bridge: BridgeSessionView) {
  const s = bridge.state;
  const sharedParametersFilename = s?.sharedParametersFilename ?? null;
  return Effect.succeed({
    buildStamp: bridge.buildStamp ?? null,
    lane: bridge.lane ?? null,
    sandboxId: bridge.sandboxId ?? null,
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
    availableModules: s?.availableModules ?? [],
    bridgeIsConnected: bridge.connected,
    openDocumentCount: typeof s?.openDocumentCount === "number" ? s.openDocumentCount : 0,
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
        activeDocumentTitle: bridge.state?.activeDocumentTitle ?? null,
        // Observed facts only: the lane/buildStamp the session reported. Never staleness.
        buildStamp: bridge.buildStamp ?? null,
        connected: true,
        lane: bridge.lane ?? null,
        openDocumentCount:
          typeof bridge.state?.openDocumentCount === "number" ? bridge.state.openDocumentCount : 0,
        processId: bridge.processId ?? null,
        revitVersion: bridge.state?.revitVersion ?? null,
        runtimeFramework: bridge.state?.runtimeFramework ?? null,
        sandboxId: bridge.sandboxId ?? null,
        sessionId: bridge.sessionId!,
      })),
  };
});

export const getSettingsWorkspaces = Effect.fnUntraced(function* (ctx: LocalOpContext) {
  const bridgeModules = ctx.bridge.connected
    ? yield* Effect.result(ctx.invokeBridge("settings.module-catalog"))
    : undefined;
  const modules =
    bridgeModules?._tag === "Success"
      ? mergeSettingsModules(
          neutralSettingsModules(),
          normalizeBridgeModuleCatalog(bridgeModules.success),
        )
      : neutralSettingsModules();

  return {
    workspaces: [
      {
        workspaceKey: "default",
        displayName: "Default Workspace",
        basePath: defaultSettingsBasePath(),
        modules: modules.map((module) => ({
          moduleKey: module.moduleKey,
          defaultRootKey: module.defaultRootKey,
          roots: module.roots,
        })),
      } satisfies SettingsWorkspaceDescriptor,
    ],
  } satisfies SettingsWorkspacesData;
});

export const tailLogs = Effect.fnUntraced(function* (input: HostLogsRequest) {
  const request = normalizeLogsRequest(input);
  const files = yield* readRequestedLogFiles(request);
  return { files } satisfies HostLogsData;
});

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

function neutralSettingsModules(): SettingsModuleWorkspaceDescriptor[] {
  return [
    {
      moduleKey: "Global",
      defaultRootKey: "fragments",
      roots: [{ rootKey: "fragments", displayName: "fragments" }],
    },
  ];
}

function normalizeBridgeModuleCatalog(value: unknown): SettingsModuleWorkspaceDescriptor[] {
  const parsed = value as Partial<{ modules: SettingsModuleWorkspaceDescriptor[] }>;
  return Array.isArray(parsed.modules) ? parsed.modules : [];
}

function mergeSettingsModules(
  localModules: SettingsModuleWorkspaceDescriptor[],
  bridgeModules: SettingsModuleWorkspaceDescriptor[],
): SettingsModuleWorkspaceDescriptor[] {
  const modules = new Map<string, SettingsModuleWorkspaceDescriptor>();
  for (const module of localModules) modules.set(module.moduleKey.toLowerCase(), module);
  for (const module of bridgeModules)
    if (!modules.has(module.moduleKey.toLowerCase()))
      modules.set(module.moduleKey.toLowerCase(), module);
  return [...modules.values()];
}

function defaultSettingsBasePath(): string {
  return productSettingsRootPath();
}

export const collectRecentDocuments = Effect.fnUntraced(function* (
  input: RevitRecentDocumentsRequest,
) {
  const request = normalizeRecentDocumentsRequest(input);
  const documents = yield* collectRecentDocumentsFromLocalMachine(request);
  return {
    documents: filterRecentDocuments(documents, request),
  } satisfies RevitRecentDocumentsData;
});

const collectRecentDocumentsFromLocalMachine: (
  request: RevitRecentDocumentsRequest,
) => RecentDocumentsEffect = Effect.fnUntraced(function* (request: RevitRecentDocumentsRequest) {
  const documents = yield* collectRecentDocumentsFromRevitIni(request);
  if (request.includeRegistryMru)
    documents.push(...(yield* collectRecentDocumentsFromRegistryProfiles(request)));
  return documents;
});

function normalizeRecentDocumentsRequest(
  input: RevitRecentDocumentsRequest,
): Required<RevitRecentDocumentsRequest> {
  return {
    includeRegistryMru: input.includeRegistryMru === true,
    // Default false: cloud models are first-class recents (cld:// rows carry the
    // guids revit.apply.document.open needs); hiding them made the op useless on
    // cloud-first machines.
    localFilesOnly: input.localFilesOnly === true,
    revitYear: input.revitYear ?? null,
  };
}

const collectRecentDocumentsFromRevitIni: (
  request: RevitRecentDocumentsRequest,
) => RecentDocumentsEffect = Effect.fnUntraced(function* (request: RevitRecentDocumentsRequest) {
  const appData = process.env.APPDATA;
  if (!appData) return [];
  const revitRoot = join(
    appData,
    revitDeploymentIdentity.autodeskDirectoryName,
    revitDeploymentIdentity.revitDirectoryName,
  );
  const entries = yield* readDirectoryEntriesOrEmpty(revitRoot, "revit.catalog.recent-documents");
  const directories = entries
    .filter((entry) => entry.info.type === "Directory")
    .map((entry) => ({
      name: entry.name,
      path: join(revitRoot, entry.name),
      revitYear: getRevitYear(entry.name),
    }))
    .filter(
      (entry): entry is { name: string; path: string; revitYear: string } =>
        entry.revitYear != null && matchesRequestedRevitYear(entry.revitYear, request.revitYear),
    );

  const documents = yield* Effect.all(
    directories.map((directory) =>
      collectRecentDocumentsFromRevitIniFile(directory.path, directory.revitYear),
    ),
  );
  return documents.flat();
});

const collectRecentDocumentsFromRevitIniFile: (
  directory: string,
  revitYear: string,
) => RecentDocumentsEffect = Effect.fnUntraced(function* (directory: string, revitYear: string) {
  // Revit writes Revit.ini as UTF-16 LE; a UTF-8 read silently parses zero entries.
  const text = yield* readFileStringBomAwareOrEmpty(
    join(directory, "Revit.ini"),
    "revit.catalog.recent-documents",
  );
  if (!text) return [];

  const entries: Array<{ key: string; path: string }> = [];
  let inRecentFileList = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inRecentFileList = trimmed.toLowerCase() === "[recent file list]";
      continue;
    }
    if (!inRecentFileList) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex);
    if (!key.toLowerCase().startsWith("file")) continue;
    const path = trimmed.slice(separatorIndex + 1).trim();
    if (path) entries.push({ key, path });
  }

  const documents = yield* Effect.all(
    entries
      .sort(
        (left, right) =>
          (tryParseRank(left.key) ?? Infinity) - (tryParseRank(right.key) ?? Infinity),
      )
      .map((entry) =>
        createRecentDocumentEntry(
          RevitRecentDocumentSource.RevitIni,
          revitYear,
          tryParseRank(entry.key),
          entry.path,
          null,
        ),
      ),
  );
  return documents;
});

const collectRecentDocumentsFromRegistryProfiles: (
  request: RevitRecentDocumentsRequest,
) => RecentDocumentsEffect = Effect.fnUntraced(function* (request: RevitRecentDocumentsRequest) {
  if (process.platform !== "win32") return [];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const outputResult = yield* Effect.result(
    spawner.string(
      ChildProcess.make("reg.exe", [
        "query",
        `HKCU\\Software\\${revitDeploymentIdentity.autodeskDirectoryName}\\${revitDeploymentIdentity.revitDirectoryName}`,
        "/s",
      ]),
    ),
  );
  const output = outputResult._tag === "Success" ? outputResult.success : "";
  const rows = parseRegistryRecentDocumentRows(output);
  const documents = yield* Effect.all(
    rows
      .filter((row) => matchesRequestedRevitYear(row.revitYear, request.revitYear))
      .sort(
        (left, right) =>
          left.profile.localeCompare(right.profile) ||
          (tryParseRank(left.valueName) ?? Infinity) - (tryParseRank(right.valueName) ?? Infinity),
      )
      .map((row) =>
        createRecentDocumentEntry(
          RevitRecentDocumentSource.RegistryProfileMru,
          row.revitYear,
          tryParseRank(row.valueName),
          row.path,
          row.profile,
        ),
      ),
  );
  return documents;
});

type RegistryRecentDocumentRow = {
  readonly profile: string;
  readonly revitYear: string;
  readonly valueName: string;
  readonly path: string;
};

export function parseRegistryRecentDocumentRows(output: string): RegistryRecentDocumentRow[] {
  const rows: RegistryRecentDocumentRow[] = [];
  let currentKey = "";
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.toUpperCase().startsWith("HKEY_")) {
      currentKey = trimmed;
      continue;
    }

    const match = trimmed.match(/^(FileNameMRU\d*)\s+REG_\w+\s+(.+)$/i);
    if (!match) continue;
    const profile = getRegistryProfileName(currentKey);
    const revitYear = getRevitYear(currentKey);
    if (profile == null || revitYear == null) continue;
    rows.push({ path: match[2].trim(), profile, revitYear, valueName: match[1] });
  }
  return rows;
}

function getRegistryProfileName(key: string): string | null {
  const marker = "\\Profiles\\";
  const index = key.toLowerCase().indexOf(marker.toLowerCase());
  return index >= 0 ? key.slice(index + marker.length).split("\\")[0] || null : null;
}

const createRecentDocumentEntry: (
  source: RevitRecentDocumentSource,
  revitYear: string,
  rank: number | null,
  path: string,
  profile: string | null,
) => Effect.Effect<RevitRecentDocumentEntry, LocalOpError, FileSystem.FileSystem> =
  Effect.fnUntraced(function* (
    source: RevitRecentDocumentSource,
    revitYear: string,
    rank: number | null,
    path: string,
    profile: string | null,
  ) {
    const pathKind = getRecentDocumentPathKind(path);
    return {
      exists:
        pathKind === RevitRecentDocumentPathKind.LocalPath ? yield* localFileExists(path) : null,
      path,
      pathKind,
      profile,
      rank,
      revitYear,
      source,
      title: getRecentDocumentTitle(path, pathKind),
    } satisfies RevitRecentDocumentEntry;
  });

function filterRecentDocuments(
  documents: RevitRecentDocumentEntry[],
  request: RevitRecentDocumentsRequest,
): RevitRecentDocumentEntry[] {
  const seenPaths = new Set<string>();
  return documents.filter((entry) => {
    if (request.localFilesOnly && entry.pathKind !== RevitRecentDocumentPathKind.LocalPath)
      return false;
    if (entry.pathKind === RevitRecentDocumentPathKind.LocalPath && entry.exists === false)
      return false;
    const key = entry.path.toLowerCase();
    if (seenPaths.has(key)) return false;
    seenPaths.add(key);
    return true;
  });
}

function getRecentDocumentPathKind(path: string): RevitRecentDocumentPathKind {
  if (path.toLowerCase().startsWith("cld://")) return RevitRecentDocumentPathKind.CloudPath;
  return win32.isAbsolute(path)
    ? RevitRecentDocumentPathKind.LocalPath
    : RevitRecentDocumentPathKind.Unknown;
}

function getRecentDocumentTitle(path: string, pathKind: RevitRecentDocumentPathKind): string {
  if (pathKind === RevitRecentDocumentPathKind.LocalPath) return basename(path);
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const segment = decodeURIComponent(separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path);
  // cld:// segments embed the model guid before the display name: {guid}Name.rvt
  return segment.replace(/^\{[0-9a-fA-F-]{36}\}/, "");
}

function getRevitYear(name: string): string | null {
  return name.match(/20\d{2}/)?.[0] ?? null;
}

function matchesRequestedRevitYear(
  revitYear: string,
  requestedRevitYear: string | null | undefined,
): boolean {
  return (
    requestedRevitYear == null ||
    requestedRevitYear.trim() === "" ||
    requestedRevitYear.toLowerCase() === "all" ||
    revitYear.toLowerCase() === requestedRevitYear.toLowerCase()
  );
}

function tryParseRank(key: string): number | null {
  const digits = key.replace(/\D/g, "");
  if (!digits) return null;
  const rank = Number.parseInt(digits, 10);
  return Number.isFinite(rank) ? rank : null;
}

const localFileExists: (
  path: string,
) => Effect.Effect<boolean, LocalOpError, FileSystem.FileSystem> = Effect.fnUntraced(function* (
  path: string,
) {
  const file = yield* statOrNull(path, "revit.catalog.recent-documents");
  return file?.type === "File";
});
