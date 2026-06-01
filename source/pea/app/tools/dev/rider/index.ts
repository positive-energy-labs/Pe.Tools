import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { WorkflowCommandResult } from "../pe-dev-workflow/index.js";
import {
  defaultRiderBridgeBaseUrl,
  runRiderBridgeRestartRrdHelper as runRiderBridgeRestartRrdHelper,
  runRiderBridgeSyncHelper as runRiderBridgeSyncHelper,
  type RiderBridgeHotReloadResponse,
} from "./bridge.js";
import { collectHostContext } from "../shared.js";
import { resolveHostBaseUrl } from "../../../pe-host.js";

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
  const result = (await runRiderBridgeRestartRrdHelper({
    repoRoot: await resolveRepoRoot(),
    timeoutSeconds: request.timeoutSeconds,
    riderBridgeBaseUrl: request.riderBridgeBaseUrl,
    project: request.project,
    actionId: request.actionId,
  })) as WorkflowCommandResult;

  const bridgeReadiness = result.ok
    ? await pollHostBridgeReadiness({
        pollSeconds: request.pollSeconds,
        pollIntervalSeconds: request.pollIntervalSeconds,
        expectedRevitVersion: request.expectedRevitVersion,
        requireNewProcess: request.requireNewProcess,
        readinessLevel: resolvedOpenDocument.path != null ? "ModulesLoaded" : request.readinessLevel,
        previousProcessId: previousSession.processId,
        previousSessionId: previousSession.sessionId,
      })
    : {
        ok: false,
        attempts: 0,
        reason:
          "Restart action did not invoke successfully; skipped Host/Revit bridge polling.",
        checks: [],
        previousProcessId: previousSession.processId,
        previousSessionId: previousSession.sessionId,
      };

  const openDocument =
    result.ok && bridgeReadiness.ok && resolvedOpenDocument.path != null
      ? await openRevitDocument({ path: resolvedOpenDocument.path })
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
      previousSession,
      bridgeReadiness,
      resolvedOpenDocument,
      openDocument,
      finalReadiness,
    },
    stdoutTail: JSON.stringify(
      {
        riderBridge: isRecord(result.json) ? result.json : result.stdoutTail,
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
        ? "RRD restart action invoked and Pe.Host reports a connected Revit bridge/session. Run an attached script/test/log proof next."
        : "RRD restart action invoked, Revit bridge connected, and requested/default document was opened. Run an attached script/test/log proof next."
      : "RiderBridge restart was requested, but Pe.Host bridge readiness or document-open proof was not completed before timeout.",
  };
}

async function resolveOpenDocumentSelector(request: {
  openDocument?: OpenDocumentSelector | null;
  harnessStatePath?: string;
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
      reason: harnessState.path == null
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
  const value = JSON.parse(text) as unknown;
  return {
    path: absolutePath,
    state: isRecord(value) ? (value as HarnessState) : undefined,
  };
}

async function findRecentDocument(selector: OpenDocumentSelector): Promise<{
  path?: string;
  reason: string;
  matches: unknown[];
}> {
  const response = await fetch(`${resolveHostBaseUrl()}/api/revit/catalog/recent-documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revitYear: selector.revitYear ?? "2025",
      localFilesOnly: selector.localFilesOnly ?? true,
    }),
  });
  const text = await response.text();
  const body = text.length > 0 ? tryParseJson(text) : null;
  if (!response.ok || !isRecord(body) || !Array.isArray(body.documents)) {
    return {
      reason: `Failed to resolve recent Revit document: HTTP ${response.status} ${response.statusText}`,
      matches: [],
    };
  }

  const name = selector.name?.trim().toLowerCase() ?? "";
  const documents = body.documents.filter(isRecord);
  const kind = selector.kind ?? "Any";
  const matches = documents.filter((document) => {
    const path = typeof document.path === "string" ? document.path : "";
    const title = typeof document.title === "string" ? document.title : "";
    const exists = document.exists !== false;
    const kindMatches =
      kind === "Any" ||
      (kind === "Project" && path.toLowerCase().endsWith(".rvt")) ||
      (kind === "Family" && path.toLowerCase().endsWith(".rfa"));
    return (
      exists &&
      kindMatches &&
      (title.toLowerCase() === name ||
        path.toLowerCase() === name ||
        title.toLowerCase().includes(name) ||
        path.toLowerCase().includes(name))
    );
  });

  if (matches.length === 0) {
    return {
      reason: `No recent local Revit document matched name '${selector.name}'.`,
      matches: [],
    };
  }

  const first = matches[0];
  const path = typeof first.path === "string" ? first.path : undefined;
  return {
    path,
    reason: `Resolved '${selector.name}' to recent document '${path}'.`,
    matches: matches.slice(0, 5),
  };
}

async function openRevitDocument(request: { path: string }): Promise<{
  ok: boolean;
  reason: string;
  response?: unknown;
}> {
  try {
    const response = await fetch(`${resolveHostBaseUrl()}/api/revit/document/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: request.path }),
    });
    const text = await response.text();
    const body = text.length > 0 ? tryParseJson(text) : null;
    if (!response.ok) {
      return {
        ok: false,
        reason: `Failed to open Revit document: HTTP ${response.status} ${response.statusText}`,
        response: body ?? text,
      };
    }

    return {
      ok: true,
      reason: "Requested Revit document opened.",
      response: body,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
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
        reason: `Pe.Host reports RRD ready at ${options.readinessLevel}.`,
        checks,
        previousProcessId: options.previousProcessId,
        previousSessionId: options.previousSessionId,
        currentProcessId: lastSession.processId,
        currentSessionId: lastSession.sessionId,
        host: lastHost,
      };
    }

    if (Date.now() >= deadline) break;
    await delay(
      Math.min(options.pollIntervalSeconds, Math.max(options.pollSeconds, 1)) *
        1000,
    );
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
    ["ModulesLoaded", "AnyDocumentOpen", "ActiveDocumentReady"].includes(
      options.readinessLevel,
    ) &&
    (session.availableModuleCount ?? 0) <= 0
  )
    missing.push("runtime modules not loaded");
  if (
    ["AnyDocumentOpen", "ActiveDocumentReady"].includes(
      options.readinessLevel,
    ) &&
    (session.openDocumentCount ?? 0) <= 0
  )
    missing.push("no open documents");
  if (
    options.readinessLevel === "ActiveDocumentReady" &&
    !session.hasActiveDocument
  )
    missing.push("no active document");
  return missing;
}

function extractHostSessionFacts(
  host: Awaited<ReturnType<typeof collectHostContext>>,
): {
  bridgeIsConnected?: boolean;
  sessionId?: string;
  processId?: number;
  revitVersion?: string;
  openDocumentCount?: number;
  availableModuleCount?: number;
  hasActiveDocument?: boolean;
} {
  const session: Record<string, unknown> = isRecord(host.session)
    ? host.session
    : {};
  return {
    bridgeIsConnected:
      (isRecord(host.probe) && host.probe.bridgeIsConnected === true) ||
      session.bridgeIsConnected === true,
    sessionId:
      typeof session.sessionId === "string" ? session.sessionId : undefined,
    processId:
      typeof session.processId === "number" ? session.processId : undefined,
    revitVersion:
      typeof session.revitVersion === "string"
        ? session.revitVersion
        : undefined,
    openDocumentCount:
      typeof session.openDocumentCount === "number"
        ? session.openDocumentCount
        : undefined,
    availableModuleCount:
      typeof session.availableModuleCount === "number"
        ? session.availableModuleCount
        : undefined,
    hasActiveDocument:
      isRecord(session.activeDocument) &&
      Object.keys(session.activeDocument).length > 0,
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
  const hotReload =
    isRecord(result.json) && isRecord(result.json.hotReload)
      ? (result.json.hotReload as RiderBridgeHotReloadResponse)
      : null;
  const lane =
    isRecord(result.json) && typeof result.json.lane === "string"
      ? result.json.lane
      : result.executable.source;

  return {
    checkedAt: lastSyncResult.checkedAt,
    lane,
    ok: result.ok,
    verdict: result.runtimeFreshness?.verdict ?? "unknown",
    loadedGraphVerdict:
      result.runtimeFreshness?.loadedGraphVerdict ?? "unknown",
    sourceDeltaVerdict:
      result.runtimeFreshness?.sourceDeltaVerdict ?? "unknown",
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

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
