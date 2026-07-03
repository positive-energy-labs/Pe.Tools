import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { runRepoLocalPeDevWorkflow, type WorkflowCommandResult } from "../pe-dev-workflow/index.js";
import {
  readRiderBridgeHotReloadResponse,
  runRiderBridgeRestartRrdHelper,
  runRiderBridgeSyncHelper,
} from "./bridge.js";
import { collectHostContext } from "../../shared/host-context.js";
import { HostRpcCaller } from "../../shared/host-rpc-caller.js";

export { defaultRiderBridgeBaseUrl } from "./bridge.js";

interface LastSyncResult {
  checkedAt: string;
  result: WorkflowCommandResult;
}

let lastSyncResult: LastSyncResult | null = null;

export async function runRiderBridgeSync(request: {
  timeoutSeconds: number;
  riderBridgeBaseUrl: string;
  project: string;
}): Promise<WorkflowCommandResult> {
  const result = await runRiderBridgeSyncHelper({
    repoRoot: await resolveRepoRoot(),
    timeoutSeconds: request.timeoutSeconds,
    riderBridgeBaseUrl: request.riderBridgeBaseUrl,
    project: request.project,
  });
  rememberLastSyncResult(result);
  return result;
}

type RestartReadinessLevel =
  | "BridgeConnected"
  | "ModulesLoaded"
  | "AnyDocumentOpen"
  | "ActiveDocumentReady";

interface OpenDocumentSelector {
  path?: string;
  name?: string;
  revitYear?: string;
  kind?: "Project" | "Family" | "Any";
  localFilesOnly?: boolean;
}

interface HarnessState {
  revit?: {
    defaultOpenDocument?: OpenDocumentSelector;
  };
}

export async function runRiderBridgeRestartRrd(request: {
  timeoutSeconds: number;
  riderBridgeBaseUrl: string;
  project: string;
  actionId?: string;
  pollSeconds: number;
  pollIntervalSeconds: number;
  expectedRevitVersion: string;
  requireNewProcess: boolean;
  readinessLevel: RestartReadinessLevel;
  openDocument?: OpenDocumentSelector | null;
  harnessStatePath?: string;
}): Promise<WorkflowCommandResult> {
  const resolvedOpenDocument = await resolveOpenDocumentSelector(request);
  const previousHost = await collectHostContext();
  const previousSession = extractHostSessionFacts(previousHost);
  const approvalWatcher = await startApprovalWatcherForRestart({
    expectedRevitVersion: request.expectedRevitVersion,
    timeoutSeconds: request.timeoutSeconds,
  });
  if (approvalWatcher != null && !approvalWatcher.ok) {
    return {
      ...approvalWatcher,
      workflow: "restart_rrd",
      policy: "RrdRequired",
      json: {
        approvalWatcher,
        previousSession,
        resolvedOpenDocument,
      },
      guidance:
        "RRD restart was skipped because the unsigned-addin approval watcher could not be started for the requested Revit year.",
    };
  }

  const result = await runRiderBridgeRestartRrdHelper({
    repoRoot: await resolveRepoRoot(),
    timeoutSeconds: request.timeoutSeconds,
    riderBridgeBaseUrl: request.riderBridgeBaseUrl,
    project: request.project,
    actionId: request.actionId,
    expectedRevitVersion: request.expectedRevitVersion,
  });

  const bridgeReadiness = result.ok
    ? await pollHostBridgeReadiness({
        pollSeconds: request.pollSeconds,
        pollIntervalSeconds: request.pollIntervalSeconds,
        expectedRevitVersion: request.expectedRevitVersion,
        requireNewProcess: request.requireNewProcess,
        readinessLevel:
          resolvedOpenDocument.path != null ? "ModulesLoaded" : request.readinessLevel,
        previousProcessId: previousSession.processId,
        previousSessionId: previousSession.sessionId,
      })
    : {
        ok: false,
        attempts: 0,
        reason: "Restart action did not invoke successfully; skipped Host/Revit bridge polling.",
        checks: [],
        previousProcessId: previousSession.processId,
        previousSessionId: previousSession.sessionId,
      };

  const openDocument =
    result.ok && bridgeReadiness.ok && resolvedOpenDocument.path != null
      ? await openRevitDocument({
          path: resolvedOpenDocument.path,
          timeoutSeconds: request.timeoutSeconds,
        })
      : null;
  const finalReadiness =
    openDocument?.ok === true
      ? await pollHostBridgeReadiness({
          pollSeconds: request.pollSeconds,
          pollIntervalSeconds: request.pollIntervalSeconds,
          expectedRevitVersion: request.expectedRevitVersion,
          requireNewProcess: false,
          readinessLevel: request.readinessLevel,
          previousProcessId: previousSession.processId,
          previousSessionId: previousSession.sessionId,
        })
      : bridgeReadiness;
  const documentResolutionOk =
    resolvedOpenDocument.source === "none" || resolvedOpenDocument.path != null;
  const ok =
    result.ok &&
    documentResolutionOk &&
    bridgeReadiness.ok &&
    (openDocument?.ok ?? true) &&
    finalReadiness.ok;

  return {
    ...result,
    ok,
    exitCode: ok ? 0 : 1,
    json: {
      ...(isRecord(result.json) ? result.json : { riderBridge: result.json }),
      approvalWatcher,
      previousSession,
      bridgeReadiness,
      resolvedOpenDocument,
      openDocument,
      finalReadiness,
    },
    stdoutTail: JSON.stringify(
      {
        riderBridge: isRecord(result.json) ? result.json : result.stdoutTail,
        approvalWatcher,
        previousSession,
        bridgeReadiness,
        resolvedOpenDocument,
        openDocument,
        finalReadiness,
      },
      null,
      2,
    ),
    stderrTail: ok
      ? ""
      : [
          result.stderrTail,
          documentResolutionOk ? null : resolvedOpenDocument.reason,
          bridgeReadiness.ok ? null : bridgeReadiness.reason,
          openDocument != null && !openDocument.ok ? openDocument.reason : null,
          finalReadiness.ok ? null : finalReadiness.reason,
        ]
          .filter((line) => line != null && line.length > 0)
          .join("\n"),
    guidance: ok
      ? resolvedOpenDocument.path == null
        ? "RRD restart action invoked and the TS host reports a connected Revit bridge/session. Run an attached script/test/log proof next."
        : "RRD restart action invoked, Revit bridge connected, and requested/default document was opened. Run an attached script/test/log proof next."
      : "RiderBridge restart was requested, but TS host bridge readiness or document-open proof was not completed before timeout.",
  };
}

async function startApprovalWatcherForRestart(request: {
  expectedRevitVersion: string;
  timeoutSeconds: number;
}): Promise<WorkflowCommandResult | null> {
  const revitYear = Number.parseInt(request.expectedRevitVersion, 10);
  if (!Number.isFinite(revitYear)) return null;

  return runRepoLocalPeDevWorkflow(
    "restart_rrd:approval-watcher",
    [
      "__internal",
      "approve-worker",
      "--revit-year",
      String(revitYear),
      "--timeout-seconds",
      String(Math.max(120, Math.min(request.timeoutSeconds, 600))),
    ],
    "RrdRequired",
    30,
  );
}

async function resolveOpenDocumentSelector(request: {
  openDocument?: OpenDocumentSelector | null;
  harnessStatePath?: string;
  timeoutSeconds: number;
}): Promise<{
  source: "explicit" | "harnessState" | "none";
  selector?: OpenDocumentSelector;
  path?: string;
  reason: string;
  harnessStatePath?: string;
  matches?: unknown[];
}> {
  if (request.openDocument === null) {
    return {
      source: "none",
      reason: "Explicit openDocument=null disabled the harness default.",
    };
  }

  const harnessState = await readHarnessState(request.harnessStatePath);
  const selector = request.openDocument ?? harnessState.state?.revit?.defaultOpenDocument;
  if (selector == null)
    return {
      source: "none",
      reason:
        harnessState.path == null
          ? "No explicit openDocument or harness state default was provided."
          : "Harness state did not define revit.defaultOpenDocument.",
      harnessStatePath: harnessState.path,
    };

  const source = request.openDocument == null ? "harnessState" : "explicit";
  if (selector.path != null && selector.path.trim().length > 0) {
    return {
      source,
      selector,
      path: selector.path,
      reason: `${source} document path selected.`,
      harnessStatePath: harnessState.path,
    };
  }

  if (selector.name == null || selector.name.trim().length === 0) {
    return {
      source,
      selector,
      reason: `${source} document selector did not include path or name.`,
      harnessStatePath: harnessState.path,
    };
  }

  const recent = await findRecentDocument(selector);
  return {
    source,
    selector,
    path: recent.path,
    reason: recent.reason,
    harnessStatePath: harnessState.path,
    matches: recent.matches,
  };
}

async function readHarnessState(path?: string): Promise<{
  path?: string;
  state?: HarnessState;
}> {
  if (path == null || path.trim().length === 0) return {};

  const absolutePath = isAbsolute(path) ? path : resolve(await resolveRepoRoot(), path);
  const text = await readFile(absolutePath, "utf8");
  const value: unknown = JSON.parse(text);
  return {
    path: absolutePath,
    state: readHarnessStateValue(value),
  };
}

function readHarnessStateValue(value: unknown): HarnessState | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const revit = readHarnessRevitState(record.revit);
  return revit ? { revit } : {};
}

function readHarnessRevitState(value: unknown): HarnessState["revit"] | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const defaultOpenDocument = readOpenDocumentSelector(record.defaultOpenDocument);
  return defaultOpenDocument ? { defaultOpenDocument } : {};
}

function readOpenDocumentSelector(value: unknown): OpenDocumentSelector | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const selector: OpenDocumentSelector = {
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.revitYear === "string" ? { revitYear: record.revitYear } : {}),
    ...(isOpenDocumentKind(record.kind) ? { kind: record.kind } : {}),
    ...(typeof record.localFilesOnly === "boolean"
      ? { localFilesOnly: record.localFilesOnly }
      : {}),
  };
  return Object.keys(selector).length > 0 ? selector : undefined;
}

function isOpenDocumentKind(value: unknown): value is NonNullable<OpenDocumentSelector["kind"]> {
  return value === "Project" || value === "Family" || value === "Any";
}

async function findRecentDocument(selector: OpenDocumentSelector): Promise<{
  path?: string;
  reason: string;
  matches: unknown[];
}> {
  const result = await new HostRpcCaller().callOperation(
    "revit.catalog.recent-documents",
    {
      revitYear: selector.revitYear ?? "2025",
      localFilesOnly: selector.localFilesOnly ?? true,
      includeRegistryMru: true,
    },
    "compact",
  );
  if (!result.ok) {
    return {
      reason: `Failed to resolve recent Revit document through host operation revit.catalog.recent-documents: ${result.message}`,
      matches: [],
    };
  }

  const response = isRecord(result.response) ? result.response : {};
  const documents = Array.isArray(response.documents) ? response.documents.filter(isRecord) : [];
  const name = selector.name?.trim().toLowerCase() ?? "";
  const kind = selector.kind ?? "Any";
  const matches = documents.filter((document) => {
    const path = typeof document.path === "string" ? document.path : "";
    const title = typeof document.title === "string" ? document.title : "";
    const kindMatches =
      kind === "Any" ||
      (kind === "Project" && path.toLowerCase().endsWith(".rvt")) ||
      (kind === "Family" && path.toLowerCase().endsWith(".rfa"));
    return (
      kindMatches &&
      (title.toLowerCase() === name ||
        path.toLowerCase() === name ||
        title.toLowerCase().includes(name) ||
        path.toLowerCase().includes(name))
    );
  });

  if (matches.length === 0) {
    return {
      reason: `No recent Revit document matched name '${selector.name}'.`,
      matches: [],
    };
  }

  const localMatches = matches.filter((document) => {
    const path = typeof document.path === "string" ? document.path : "";
    return document.exists !== false && !isCloudDocumentPath(path, document.pathKind);
  });
  const firstLocal = localMatches[0];
  if (firstLocal != null) {
    const path = typeof firstLocal.path === "string" ? firstLocal.path : undefined;
    return {
      path,
      reason: `Resolved '${selector.name}' to recent local document '${path}' using host operation revit.catalog.recent-documents.`,
      matches: matches.slice(0, 5),
    };
  }

  const firstMatch = matches[0];
  const matchedPath = typeof firstMatch.path === "string" ? firstMatch.path : "unknown";
  return {
    reason: `Matched '${selector.name}' to '${matchedPath}', but the restart-chain opener currently supports local Revit files only. Cloud model paths are preserved by recent-documents for future support but are not opened by revit.apply.document.open.`,
    matches: matches.slice(0, 5),
  };
}

async function openRevitDocument(request: { path: string; timeoutSeconds: number }): Promise<{
  ok: boolean;
  reason: string;
  response?: unknown;
}> {
  if (isCloudDocumentPath(request.path)) {
    return {
      ok: false,
      reason:
        "Requested document is a cloud model path, but host operation revit.apply.document.open currently supports local Revit files only.",
    };
  }

  try {
    const result = await new HostRpcCaller().callOperation(
      "revit.apply.document.open",
      { path: request.path },
      "compact",
    );
    if (!result.ok) {
      return {
        ok: false,
        reason: `Host operation revit.apply.document.open failed: ${result.message}`,
        response: result,
      };
    }

    return {
      ok: true,
      reason:
        "Host operation revit.apply.document.open opened and activated the requested document.",
      response: result.response,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isCloudDocumentPath(path: string, pathKind?: unknown): boolean {
  return pathKind === "CloudPath" || path.toLowerCase().startsWith("cld://");
}

async function pollHostBridgeReadiness(options: {
  pollSeconds: number;
  pollIntervalSeconds: number;
  expectedRevitVersion: string;
  requireNewProcess: boolean;
  readinessLevel: RestartReadinessLevel;
  previousProcessId?: number;
  previousSessionId?: string;
}): Promise<{
  ok: boolean;
  attempts: number;
  reason: string;
  checks: string[];
  previousProcessId?: number;
  previousSessionId?: string;
  currentProcessId?: number;
  currentSessionId?: string;
  host?: Awaited<ReturnType<typeof collectHostContext>>;
}> {
  const deadline = Date.now() + options.pollSeconds * 1000;
  let attempts = 0;
  let checks: string[] = [];
  let lastHost: Awaited<ReturnType<typeof collectHostContext>> | undefined;
  let lastSession: ReturnType<typeof extractHostSessionFacts> = {};
  do {
    attempts++;
    lastHost = await collectHostContext();
    lastSession = extractHostSessionFacts(lastHost);
    checks = evaluateRestartReadiness(lastHost, lastSession, options);
    if (checks.length === 0) {
      return {
        ok: true,
        attempts,
        reason: `The TS host reports RRD ready at ${options.readinessLevel}.`,
        checks,
        previousProcessId: options.previousProcessId,
        previousSessionId: options.previousSessionId,
        currentProcessId: lastSession.processId,
        currentSessionId: lastSession.sessionId,
        host: lastHost,
      };
    }

    if (Date.now() >= deadline) break;
    await delay(Math.min(options.pollIntervalSeconds, Math.max(options.pollSeconds, 1)) * 1000);
  } while (options.pollSeconds > 0);

  return {
    ok: false,
    attempts,
    reason: `Timed out before RRD reached ${options.readinessLevel}: ${checks.join("; ")}`,
    checks,
    previousProcessId: options.previousProcessId,
    previousSessionId: options.previousSessionId,
    currentProcessId: lastSession.processId,
    currentSessionId: lastSession.sessionId,
    host: lastHost,
  };
}

function evaluateRestartReadiness(
  host: Awaited<ReturnType<typeof collectHostContext>>,
  session: ReturnType<typeof extractHostSessionFacts>,
  options: {
    expectedRevitVersion: string;
    requireNewProcess: boolean;
    readinessLevel: RestartReadinessLevel;
    previousProcessId?: number;
  },
): string[] {
  const missing: string[] = [];
  if (!host.reachable) missing.push("host not reachable");
  if (!session.bridgeIsConnected) missing.push("Revit bridge not connected");
  if (
    options.expectedRevitVersion.length > 0 &&
    session.revitVersion !== options.expectedRevitVersion
  )
    missing.push(
      `expected Revit ${options.expectedRevitVersion}, got ${session.revitVersion ?? "unknown"}`,
    );
  if (
    options.requireNewProcess &&
    options.previousProcessId != null &&
    session.processId === options.previousProcessId
  )
    missing.push(`process has not changed from ${options.previousProcessId}`);

  if (
    ["ModulesLoaded", "AnyDocumentOpen", "ActiveDocumentReady"].includes(options.readinessLevel) &&
    (session.availableModuleCount ?? 0) <= 0
  )
    missing.push("runtime modules not loaded");
  if (
    ["AnyDocumentOpen", "ActiveDocumentReady"].includes(options.readinessLevel) &&
    (session.openDocumentCount ?? 0) <= 0
  )
    missing.push("no open documents");
  if (options.readinessLevel === "ActiveDocumentReady" && !session.hasActiveDocument)
    missing.push("no active document");
  return missing;
}

function extractHostSessionFacts(host: Awaited<ReturnType<typeof collectHostContext>>): {
  bridgeIsConnected?: boolean;
  sessionId?: string;
  processId?: number;
  revitVersion?: string;
  openDocumentCount?: number;
  availableModuleCount?: number;
  hasActiveDocument?: boolean;
} {
  const session: Record<string, unknown> = isRecord(host.session) ? host.session : {};
  return {
    bridgeIsConnected:
      (isRecord(host.probe) && host.probe.bridgeIsConnected === true) ||
      session.bridgeIsConnected === true,
    sessionId: typeof session.sessionId === "string" ? session.sessionId : undefined,
    processId: typeof session.processId === "number" ? session.processId : undefined,
    revitVersion: typeof session.revitVersion === "string" ? session.revitVersion : undefined,
    openDocumentCount:
      typeof session.openDocumentCount === "number" ? session.openDocumentCount : undefined,
    availableModuleCount:
      typeof session.availableModuleCount === "number" ? session.availableModuleCount : undefined,
    hasActiveDocument:
      isRecord(session.activeDocument) && Object.keys(session.activeDocument).length > 0,
  };
}

function rememberLastSyncResult(result: WorkflowCommandResult): void {
  lastSyncResult = {
    checkedAt: new Date().toISOString(),
    result,
  };
}

export function summarizeLastSyncResult() {
  if (lastSyncResult == null) return null;

  const result = lastSyncResult.result;
  const hotReload = readRiderBridgeHotReloadResponse(readRecord(result.json)?.hotReload);
  const lane =
    isRecord(result.json) && typeof result.json.lane === "string"
      ? result.json.lane
      : result.executable.source;

  return {
    checkedAt: lastSyncResult.checkedAt,
    lane,
    ok: result.ok,
    verdict: result.runtimeFreshness?.verdict ?? "unknown",
    loadedGraphVerdict: result.runtimeFreshness?.loadedGraphVerdict ?? "unknown",
    sourceDeltaVerdict: result.runtimeFreshness?.sourceDeltaVerdict ?? "unknown",
    actionStatuses:
      hotReload?.results?.map((action) => ({
        actionId: action.actionId ?? "unknown",
        status: action.status ?? "unknown",
        ok: action.ok ?? false,
        message: action.message ?? null,
      })) ?? [],
    proofSummary: result.proof.interpretation,
    guidance: result.guidance ?? null,
  };
}

async function resolveRepoRoot(): Promise<string> {
  let current = process.cwd();
  while (true) {
    if (await isFile(resolve(current, "Pe.Tools.slnx"))) return current;

    const parent = resolve(current, "..");
    if (parent === current) return process.cwd();

    current = parent;
  }
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
