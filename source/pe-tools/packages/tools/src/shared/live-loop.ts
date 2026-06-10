import { HostLogTarget, PeHostClient } from "@pe/host-client";
import { resolveExecutable } from "../dev/pe-dev-workflow/index.js";
import {
  defaultRiderBridgeBaseUrl,
  runRiderBridgeRestartRrd,
  runRiderBridgeSync,
  summarizeLastSyncResult as summarizeLiveRrdLastSyncResult,
} from "../dev/rider/index.js";
import { collectHostContext } from "./host-context.js";

export { defaultRiderBridgeBaseUrl } from "../dev/rider/index.js";

export const defaultLiveLoopTimeoutSeconds = 900;

export type LiveLoopExecutionPolicy =
  | "NoRrdContact"
  | "DiagnosticsOnly"
  | "RrdRequired"
  | "FreshRevitProcess";

export type LiveLoopLogTarget = "all" | "host" | "revit";
export type LiveLoopLogCursorMode = "read" | "reset";
export type LiveRrdRestartReadinessLevel =
  | "BridgeConnected"
  | "ModulesLoaded"
  | "AnyDocumentOpen"
  | "ActiveDocumentReady";

export interface LiveRrdOpenDocumentSelector {
  path?: string;
  name?: string;
  revitYear?: string;
  kind?: "Project" | "Family" | "Any";
  localFilesOnly?: boolean;
}

export interface LiveLoopContextOptions {
  hostBaseUrl?: string;
  logTail?: number;
  resetLogCursor?: boolean;
  includeLastSync?: boolean;
  timeoutSeconds?: number;
}

export interface LiveRrdSyncOptions {
  timeoutSeconds?: number;
  riderBridgeBaseUrl?: string;
  project?: string;
}

export interface LiveRrdRestartOptions extends LiveRrdSyncOptions {
  actionId?: string;
  pollSeconds?: number;
  pollIntervalSeconds?: number;
  expectedRevitVersion?: string;
  requireNewProcess?: boolean;
  readinessLevel?: LiveRrdRestartReadinessLevel;
  openDocument?: LiveRrdOpenDocumentSelector | null;
  harnessStatePath?: string;
}

interface LogCursor {
  checkedAt: string;
  size: number;
  lineCount: number;
}

const logCursorStore = new Map<string, LogCursor>();

export async function collectRuntimeLoopContext(options: LiveLoopContextOptions = {}) {
  const logTail = options.logTail ?? 10;
  const resetLogCursor = options.resetLogCursor ?? false;
  const includeLastSync = options.includeLastSync ?? true;
  const timeoutSeconds = options.timeoutSeconds ?? defaultLiveLoopTimeoutSeconds;

  const [environment, logResult] = await Promise.all([
    collectLiveLoopEnvironment({
      hostBaseUrl: options.hostBaseUrl,
      includeHost: true,
    }),
    readPeaHostLogTails("all", logTail, resetLogCursor ? "reset" : "read", {
      hostBaseUrl: options.hostBaseUrl,
    }),
  ]);
  const syncSummary = includeLastSync ? summarizeLiveRrdLastSyncResult() : null;
  const recommendation = recommendRuntimeLoopNextAction(environment, logResult, syncSummary);

  return {
    ok: true,
    workflow: "live_loop_context",
    policy: "DiagnosticsOnly" satisfies LiveLoopExecutionPolicy,
    checkedAt: new Date().toISOString(),
    request: {
      hostBaseUrl: PeHostClient.resolveHostBaseUrl(options.hostBaseUrl),
      logTail,
      resetLogCursor,
      includeLastSync,
      timeoutSeconds,
    },
    environment,
    logs: logResult,
    lastSync: syncSummary,
    recommendation,
    limits: [
      "Read-only packet: does not run sync, tests, scripts, hot reload, or restart Revit/Rider.",
      "Log deltas are correlation evidence, not health proof by themselves.",
      "A successful RiderBridge sync proves IDE action invocation only until attached behavior or Revit logs confirm the runtime change.",
    ],
  };
}

export async function syncLiveRrd(options: LiveRrdSyncOptions = {}) {
  return runRiderBridgeSync({
    timeoutSeconds: options.timeoutSeconds ?? defaultLiveLoopTimeoutSeconds,
    riderBridgeBaseUrl: options.riderBridgeBaseUrl ?? defaultRiderBridgeBaseUrl,
    project: options.project ?? "Pe.Tools",
  });
}

export async function restartLiveRrd(options: LiveRrdRestartOptions = {}) {
  return runRiderBridgeRestartRrd({
    timeoutSeconds: options.timeoutSeconds ?? defaultLiveLoopTimeoutSeconds,
    riderBridgeBaseUrl: options.riderBridgeBaseUrl ?? defaultRiderBridgeBaseUrl,
    project: options.project ?? "Pe.Tools",
    actionId: options.actionId,
    pollSeconds: options.pollSeconds ?? 180,
    pollIntervalSeconds: options.pollIntervalSeconds ?? 5,
    expectedRevitVersion: options.expectedRevitVersion ?? "2025",
    requireNewProcess: options.requireNewProcess ?? true,
    readinessLevel: options.readinessLevel ?? "ModulesLoaded",
    openDocument: options.openDocument,
    harnessStatePath: options.harnessStatePath,
  });
}

export async function collectLiveLoopEnvironment(
  options: { hostBaseUrl?: string; includeHost?: boolean } = {},
) {
  const dotnetExecutable = await resolveExecutable("dotnet");
  const host =
    options.includeHost === false
      ? undefined
      : await collectHostContext({ hostBaseUrl: options.hostBaseUrl });

  return {
    ok: true,
    workflow: "live_loop_environment",
    policy: "DiagnosticsOnly" satisfies LiveLoopExecutionPolicy,
    checkedAt: new Date().toISOString(),
    cwd: process.cwd(),
    hostBaseUrl: PeHostClient.resolveHostBaseUrl(options.hostBaseUrl),
    executables: {
      dotnet: dotnetExecutable,
    },
    host,
    guidance: environmentGuidance(host),
  };
}

export async function readPeaHostLogTails(
  target: LiveLoopLogTarget,
  tailLineCount: number,
  cursorMode: LiveLoopLogCursorMode,
  options: { hostBaseUrl?: string } = {},
) {
  const checkedAt = new Date().toISOString();
  try {
    const hostBaseUrl = PeHostClient.resolveHostBaseUrl(options.hostBaseUrl);
    const response = await new PeHostClient({
      baseUrl: hostBaseUrl,
    }).host.getLogs({
      target: parseHostLogTarget(target),
      tailLineCount,
    });
    const logs = response.files.map((file) => {
      const cursorKey = file.filePath.toLowerCase();
      const storedCursor = logCursorStore.get(cursorKey);
      const previousCursor = cursorMode === "reset" ? undefined : storedCursor;
      const invalidated = previousCursor != null && file.lines.length < previousCursor.lineCount;
      const previousLineCount =
        previousCursor == null || invalidated ? file.lines.length : previousCursor.lineCount;
      const newLines =
        previousCursor == null || invalidated ? [] : file.lines.slice(previousLineCount);
      const nextCursor = {
        checkedAt,
        size: file.lines.join("\n").length,
        lineCount: file.lines.length,
      } satisfies LogCursor;

      logCursorStore.set(cursorKey, nextCursor);
      return {
        label: file.label,
        path: file.filePath,
        exists: true,
        lineCount: file.lines.length,
        cursor: {
          mode: cursorMode,
          previous: storedCursor ?? null,
          current: nextCursor,
          invalidated,
          newLineCountSinceLastCheck: newLines.length,
        },
        tail: file.lines.join("\n"),
        newTail: newLines.slice(Math.max(0, newLines.length - tailLineCount)).join("\n"),
      };
    });

    return {
      ok: true,
      workflow: "pea_host_logs",
      policy: "DiagnosticsOnly" satisfies LiveLoopExecutionPolicy,
      checkedAt,
      source: "Pea product host log operation",
      logs,
    };
  } catch (error) {
    return {
      ok: false,
      workflow: "pea_host_logs",
      policy: "DiagnosticsOnly" satisfies LiveLoopExecutionPolicy,
      checkedAt,
      source: "Pea product host log operation",
      error: error instanceof Error ? error.message : String(error),
      logs: [],
    };
  }
}

function recommendRuntimeLoopNextAction(
  environment: Awaited<ReturnType<typeof collectLiveLoopEnvironment>>,
  logResult: Awaited<ReturnType<typeof readPeaHostLogTails>>,
  syncSummary: ReturnType<typeof summarizeLiveRrdLastSyncResult>,
) {
  const host = environment.host;
  const hostReachable = host?.reachable === true;
  const bridgeConnected = isRecord(host?.probe) && host.probe.bridgeIsConnected === true;
  const activeDocument = isRecord(host?.session) && host.session.activeDocument != null;
  const newLogLineCount = logResult.logs.reduce(
    (count, log) => count + log.cursor.newLineCountSinceLastCheck,
    0,
  );

  if (!hostReachable) {
    return {
      lane: "DiagnosticsOnly",
      nextAction: "read_logs",
      confidence: "high",
      reason:
        "Pe.Host is not reachable from the environment packet; inspect host/Revit logs before attempting attached runtime work.",
    };
  }

  if (!bridgeConnected) {
    return {
      lane: "AttachedRrd",
      nextAction: "ask_user",
      confidence: "high",
      reason:
        "Host is reachable but the private Revit bridge is not connected; user-maintained RRD/Revit state is the blocker.",
    };
  }

  if (!activeDocument) {
    return {
      lane: "AttachedRrd",
      nextAction: "ask_user",
      confidence: "medium",
      reason:
        "AttachedRrd appears connected but no active document was reported; document-dependent probes need user session setup first.",
    };
  }

  if (syncSummary == null) {
    return {
      lane: "AttachedRrd",
      nextAction: "live_rrd_sync",
      confidence: "medium",
      reason:
        "No sync result is known in this peco process; run live_rrd_sync before relying on attached runtime behavior after runtime edits.",
    };
  }

  if (!syncSummary.ok || syncSummary.verdict === "stale") {
    return {
      lane: "AttachedRrd",
      nextAction: "live_rrd_restart",
      confidence: syncSummary.verdict === "stale" ? "high" : "medium",
      reason: `Last sync via ${syncSummary.lane} failed or reported stale freshness; recover Rider/RRD before trusting attached behavior.`,
    };
  }

  if (newLogLineCount > 0) {
    return {
      lane: "DiagnosticsOnly",
      nextAction: "read_logs",
      confidence: "medium",
      reason: `${newLogLineCount} new host/Revit log line(s) were observed since the previous cursor; inspect deltas before continuing if they correlate with a failure window.`,
    };
  }

  if (syncSummary.verdict === "unproven") {
    return {
      lane: "AttachedRrd",
      nextAction: "continue",
      confidence: "medium",
      reason: `Last sync via ${syncSummary.lane} succeeded but freshness is unproven; continue only to an attached operation/script/log proof boundary, or switch to FreshRevitProcess for proof-grade autonomous validation.`,
    };
  }

  return {
    lane: "AttachedRrd",
    nextAction: "continue",
    confidence: "high",
    reason: `Last sync via ${syncSummary.lane} is available and no new log deltas suggest a current runtime incident; continue with the next explicit attached probe.`,
  };
}

function environmentGuidance(
  host: Awaited<ReturnType<typeof collectHostContext>> | undefined,
): string[] {
  const guidance = [
    "Use source compile/package proof for ordinary source work; use live-loop only when Rider/Revit/Windows session state matters.",
  ];

  if (host && !host.reachable)
    guidance.push(
      "Pe.Host is not reachable. Inspect the live_loop_context log slice before attempting host operations or scripts.",
    );

  const bridgeConnected =
    host?.probe && "bridgeIsConnected" in host.probe && host.probe.bridgeIsConnected;
  if (host?.reachable && !bridgeConnected)
    guidance.push(
      "Host is reachable but the Revit bridge is not connected; AttachedRrd proof is not available until the live session is healthy.",
    );

  return guidance;
}

function parseHostLogTarget(target: LiveLoopLogTarget): HostLogTarget {
  switch (target) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
      return HostLogTarget.Revit;
    case "all":
      return HostLogTarget.All;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
