import { HostLogTarget } from "@pe/host-contracts/operation-types";
import { summarizeLastSyncResult as summarizeLiveRrdLastSyncResult } from "../dev/sdk-live.js";
import { collectHostContext } from "./host-context.js";
import { HostRpcCaller } from "./host-rpc-caller.js";
import { resolveHostBaseUrl } from "./host-config.js";

export const defaultPeaRuntimeTimeoutSeconds = 900;

export type PeaRuntimeLogTarget = "all" | "host" | "revit";
export type PeaRuntimeLogCursorMode = "read" | "reset";

export interface PeaRuntimeContextOptions {
  hostBaseUrl?: string;
  logTail?: number;
  resetLogCursor?: boolean;
  includeLastSync?: boolean;
  timeoutSeconds?: number;
}

export interface LogCursor {
  checkedAt: string;
  size: number;
  lineCount: number;
}

const logCursorStore = new Map<string, LogCursor>();

export async function collectRuntimeLoopContext(options: PeaRuntimeContextOptions = {}) {
  const logTail = options.logTail ?? 10;
  const resetLogCursor = options.resetLogCursor ?? false;
  const includeLastSync = options.includeLastSync ?? true;
  const timeoutSeconds = options.timeoutSeconds ?? defaultPeaRuntimeTimeoutSeconds;

  const [environment, logResult] = await Promise.all([
    collectPeaRuntimeEnvironment({
      hostBaseUrl: options.hostBaseUrl,
      includeHost: true,
    }),
    readPeaHostLogTails("all", logTail, resetLogCursor ? "reset" : "read", {
      hostBaseUrl: options.hostBaseUrl,
    }),
  ]);
  const syncSummary = includeLastSync ? summarizeLiveRrdLastSyncResult() : null;

  return {
    ok: true,
    workflow: "live_loop_context",
    policy: "DiagnosticsOnly",
    checkedAt: new Date().toISOString(),
    request: {
      hostBaseUrl: resolveHostBaseUrl(options.hostBaseUrl),
      logTail,
      resetLogCursor,
      includeLastSync,
      timeoutSeconds,
    },
    environment,
    logs: logResult,
    lastSync: syncSummary,
    limits: [
      "Read-only packet: does not run sync, tests, scripts, hot reload, or restart Revit/Rider.",
      "Log deltas are correlation evidence, not health proof by themselves.",
      "A successful SDK live run proves the convergence attempt only until attached behavior or Revit logs confirm the runtime path.",
    ],
  };
}

export async function collectPostLiveCommandHooks(options: {
  includePeaStatus: boolean;
  logTail: number;
  resetLogCursor: boolean;
  hostBaseUrl?: string;
}) {
  const [peaHostStatus, peaLogs] = await Promise.all([
    options.includePeaStatus
      ? collectPeaRuntimeEnvironment({ includeHost: true, hostBaseUrl: options.hostBaseUrl })
      : Promise.resolve(null),
    options.logTail > 0
      ? readPeaHostLogTails("all", options.logTail, options.resetLogCursor ? "reset" : "read", {
          hostBaseUrl: options.hostBaseUrl,
        })
      : Promise.resolve(null),
  ]);

  return {
    peaHostStatus,
    peaLogs,
  };
}

export async function collectPeaRuntimeEnvironment(
  options: { hostBaseUrl?: string; includeHost?: boolean } = {},
) {
  const host =
    options.includeHost === false
      ? undefined
      : await collectHostContext({ hostBaseUrl: options.hostBaseUrl });

  return {
    ok: true,
    workflow: "pea_runtime_environment",
    policy: "DiagnosticsOnly",
    checkedAt: new Date().toISOString(),
    cwd: process.cwd(),
    hostBaseUrl: resolveHostBaseUrl(options.hostBaseUrl),
    host,
  };
}

export async function readPeaHostLogTails(
  target: PeaRuntimeLogTarget,
  tailLineCount: number,
  cursorMode: PeaRuntimeLogCursorMode,
  options: { hostBaseUrl?: string } = {},
) {
  const checkedAt = new Date().toISOString();
  try {
    const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
    const response = await new HostRpcCaller({
      hostBaseUrl: hostBaseUrl,
    }).call("logs.tail", {
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
      policy: "DiagnosticsOnly",
      checkedAt,
      source: "Pea product host log operation",
      logs,
    };
  } catch (error) {
    return {
      ok: false,
      workflow: "pea_host_logs",
      policy: "DiagnosticsOnly",
      checkedAt,
      source: "Pea product host log operation",
      error: error instanceof Error ? error.message : String(error),
      logs: [],
    };
  }
}

function parseHostLogTarget(target: PeaRuntimeLogTarget): HostLogTarget {
  switch (target) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
      return HostLogTarget.Revit;
    case "all":
      return HostLogTarget.All;
  }
}
