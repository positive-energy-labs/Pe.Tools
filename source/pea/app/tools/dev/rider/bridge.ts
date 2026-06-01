import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const defaultRiderBridgeBaseUrl = "http://127.0.0.1:63342";
export const hotReloadSignalPath =
  "source/Pe.Revit.Global/HotReload/PeHotReloadSignal.cs";

export interface RiderBridgeSyncRequest {
  repoRoot: string;
  timeoutSeconds: number;
  riderBridgeBaseUrl: string;
  project: string;
}

export interface RiderBridgeActionResult {
  actionId?: string;
  status?: string;
  ok?: boolean;
  message?: string;
}

export interface RiderBridgeProblem {
  severity?: string;
  source?: string;
  actionId?: string;
  message?: string;
}

export interface RiderBridgeHotReloadResponse {
  ok?: boolean;
  operation?: string;
  project?: string;
  projectBasePath?: string;
  debugSession?: unknown;
  results?: RiderBridgeActionResult[];
  problems?: RiderBridgeProblem[];
  restartRecommended?: boolean;
  error?: string;
}

export interface RiderBridgeRestartRrdRequest extends RiderBridgeSyncRequest {
  actionId?: string;
}

export async function runRiderBridgeSyncHelper(
  request: RiderBridgeSyncRequest,
): Promise<RiderBridgeSyncResult> {
  const cwd = request.repoRoot;
  const startedAt = Date.now();
  const signalPath = resolve(cwd, hotReloadSignalPath);
  const artifactPaths = [signalPath];
  const args = [
    "POST",
    `${request.riderBridgeBaseUrl.replace(/\/$/, "")}/pe-tools/hot-reload?project=${encodeURIComponent(request.project)}`,
  ];
  let ping: unknown;
  let hotReload: RiderBridgeHotReloadResponse | null = null;
  let signalStamp: string | null = null;

  try {
    signalStamp = await mutateHotReloadSignalFile(signalPath);
    ping = await requestRiderBridgeJson(
      `${request.riderBridgeBaseUrl.replace(/\/$/, "")}/pe-tools/ping`,
      "GET",
      request.timeoutSeconds,
    );
    hotReload = (await requestRiderBridgeJson(
      args[1],
      "POST",
      request.timeoutSeconds,
    )) as RiderBridgeHotReloadResponse;
    const ok =
      hotReload.ok === true &&
      Array.isArray(hotReload.results) &&
      hotReload.results.every((result) => result.ok === true);
    const durationMs = Date.now() - startedAt;
    return {
      ok,
      workflow: "sync",
      policy: "RrdRequired",
      cwd,
      executable: {
        requested: "Pe.RiderBridge",
        resolvedPath: request.riderBridgeBaseUrl,
        source: "rider-bridge",
      },
      commandLine: args.join(" "),
      args,
      exitCode: ok ? 0 : 1,
      timedOut: false,
      durationMs,
      stdoutTail: JSON.stringify({ ping, hotReload, signalStamp }, null, 2),
      stderrTail: ok
        ? ""
        : formatRiderBridgeProblems(
          hotReload,
          "Rider bridge hot reload did not report all actions invoked",
        ),
      artifactPaths,
      json: { ping, hotReload, lane: "RiderBridge", signalStamp },
      runtimeFreshness: {
        verdict: ok ? "unproven" : "stale",
        loadedGraphVerdict: "unknown",
        sourceDeltaVerdict: ok ? "unproven" : "stale",
        expectedRuntimeDelta: true,
        basis: ok
          ? "Pe.RiderBridge accepted localhost HTTP requests and reported the configured Rider hot-reload action sequence invoked. Loaded assembly fingerprint comparison is not performed by this direct dev-agent lane."
          : formatRiderBridgeProblems(
            hotReload,
            "Pe.RiderBridge did not report a successful hot-reload action sequence",
          ),
        nextStep: ok
          ? "Trigger the attached Revit operation/script/test that needs the refreshed RRD runtime and confirm behavior or log evidence."
          : hotReload?.restartRecommended === true
            ? "Restart RRD through RiderBridge, then wait for the Host/Revit bridge before retrying attached proof."
            : "Check that Rider is running, Pe.RiderBridge is installed, the project is open, and the debug session can apply changes.",
      },
      proof: proofForRiderBridgeOperation("sync", ok, false, hotReload),
      guidance: ok
        ? "RiderBridge lane completed without pe-dev/AHK. This proves Rider accepted the action sequence; use Revit logs or an attached operation for behavior proof."
        : "Recover Rider/Pe.RiderBridge or restart RRD before retrying attached proof.",
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return {
      ok: false,
      workflow: "sync",
      policy: "RrdRequired",
      cwd,
      executable: {
        requested: "Pe.RiderBridge",
        resolvedPath: request.riderBridgeBaseUrl,
        source: "missing",
      },
      commandLine: args.join(" "),
      args,
      exitCode: 1,
      timedOut: false,
      durationMs,
      stdoutTail:
        ping === undefined ? "" : JSON.stringify({ ping, hotReload }, null, 2),
      stderrTail: formatUnknownError(error),
      artifactPaths,
      json: {
        ping,
        hotReload,
        lane: "RiderBridge",
        signalStamp,
        error: formatUnknownError(error),
      },
      runtimeFreshness: {
        verdict: "stale",
        loadedGraphVerdict: "unknown",
        sourceDeltaVerdict: "stale",
        expectedRuntimeDelta: true,
        basis:
          "Direct Pe.RiderBridge sync failed before a successful Rider hot-reload action sequence was reported.",
        nextStep:
          "Check Rider/Pe.RiderBridge availability, then retry live_rrd_sync or restart RRD before attached proof.",
      },
      proof: proofForRiderBridgeOperation("sync", false, false, hotReload),
      guidance:
        "Recover Rider/Pe.RiderBridge or restart RRD before retrying attached proof.",
    };
  }
}

export async function runRiderBridgeRestartRrdHelper(
  request: RiderBridgeRestartRrdRequest,
): Promise<RiderBridgeSyncResult> {
  const cwd = request.repoRoot;
  const startedAt = Date.now();
  const bridgeBaseUrl = request.riderBridgeBaseUrl.replace(/\/$/, "");
  const endpoint = `${bridgeBaseUrl}/pe-tools/restart-rrd?project=${encodeURIComponent(request.project)}${request.actionId ? `&actionId=${encodeURIComponent(request.actionId)}` : ""}`;
  const args = ["POST", endpoint];
  let ping: unknown;
  let restart: RiderBridgeHotReloadResponse | null = null;
  let fallbackError: string | null = null;

  try {
    ping = await requestRiderBridgeJson(
      `${bridgeBaseUrl}/pe-tools/ping`,
      "GET",
      request.timeoutSeconds,
    );
    try {
      restart = (await requestRiderBridgeJson(
        endpoint,
        "POST",
        request.timeoutSeconds,
      )) as RiderBridgeHotReloadResponse;
    } catch (error) {
      fallbackError = formatUnknownError(error);
      if (!isMissingRestartEndpointError(fallbackError)) throw error;
      restart = await invokeRestartFallbackActions(
        bridgeBaseUrl,
        request,
        request.timeoutSeconds,
      );
    }

    const ok = restart.ok === true;
    const durationMs = Date.now() - startedAt;
    return {
      ok,
      workflow: "restart_rrd",
      policy: "RrdRequired",
      cwd,
      executable: {
        requested: "Pe.RiderBridge",
        resolvedPath: request.riderBridgeBaseUrl,
        source: "rider-bridge",
      },
      commandLine: args.join(" "),
      args,
      exitCode: ok ? 0 : 1,
      timedOut: false,
      durationMs,
      stdoutTail: JSON.stringify({ ping, restart, fallbackError }, null, 2),
      stderrTail: ok
        ? ""
        : formatRiderBridgeProblems(
          restart,
          "Rider bridge restart_rrd did not report a launched debug action",
        ),
      artifactPaths: [],
      json: { ping, restart, fallbackError, lane: "RiderBridge" },
      runtimeFreshness: {
        verdict: ok ? "unproven" : "stale",
        loadedGraphVerdict: "unknown",
        sourceDeltaVerdict: "unproven",
        expectedRuntimeDelta: true,
        basis: ok
          ? "Pe.RiderBridge reported a restart/debug action invoked. Revit bridge readiness must be proven separately by host polling."
          : formatRiderBridgeProblems(
            restart,
            "Pe.RiderBridge did not report a successful restart/debug action",
          ),
        nextStep: ok
          ? "Poll Pe.Host until the expected Revit bridge/session is reachable, then run an attached behavior/log proof."
          : "Check Rider, plugin install, selected debug configuration, and action availability.",
      },
      proof: proofForRiderBridgeOperation("restart_rrd", ok, false, restart),
      guidance: ok
        ? restart.operation === "restart-rrd-fallback"
          ? "Installed Pe.RiderBridge lacks /restart-rrd, but fallback Rider action invocation launched. Reinstall the rebuilt plugin for richer restart diagnostics."
          : "RiderBridge restart_rrd invoked a Rider restart/debug action. Wait for Revit and the Host bridge before attached proof."
        : "Restart action did not launch through RiderBridge; inspect returned action states/problems.",
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return {
      ok: false,
      workflow: "restart_rrd",
      policy: "RrdRequired",
      cwd,
      executable: {
        requested: "Pe.RiderBridge",
        resolvedPath: request.riderBridgeBaseUrl,
        source: "missing",
      },
      commandLine: args.join(" "),
      args,
      exitCode: 1,
      timedOut: false,
      durationMs,
      stdoutTail: ping === undefined ? "" : JSON.stringify({ ping, restart, fallbackError }, null, 2),
      stderrTail: formatUnknownError(error),
      artifactPaths: [],
      json: {
        ping,
        restart,
        fallbackError,
        lane: "RiderBridge",
        error: formatUnknownError(error),
      },
      runtimeFreshness: {
        verdict: "stale",
        loadedGraphVerdict: "unknown",
        sourceDeltaVerdict: "stale",
        expectedRuntimeDelta: true,
        basis: "Direct Pe.RiderBridge restart_rrd failed before Rider reported a restart/debug action.",
        nextStep: "Check Rider/Pe.RiderBridge availability and selected debug configuration.",
      },
      proof: proofForRiderBridgeOperation("restart_rrd", false, false, restart),
      guidance: "Restart action did not launch through RiderBridge; inspect returned error and Rider/plugin availability.",
    };
  }
}

async function invokeRestartFallbackActions(
  bridgeBaseUrl: string,
  request: RiderBridgeRestartRrdRequest,
  timeoutSeconds: number,
): Promise<RiderBridgeHotReloadResponse> {
  const actionIds = request.actionId == null ? ["Rerun", "Debug"] : [request.actionId];
  const results: RiderBridgeActionResult[] = [];
  for (const actionId of actionIds) {
    const result = (await requestRiderBridgeJson(
      `${bridgeBaseUrl}/pe-tools/actions/invoke?actionId=${encodeURIComponent(actionId)}&project=${encodeURIComponent(request.project)}`,
      "POST",
      timeoutSeconds,
    )) as RiderBridgeActionResult;
    results.push(result);
    if (result.ok === true) break;
  }

  const ok = results.some((result) => result.ok === true);
  return {
    ok,
    operation: "restart-rrd-fallback",
    project: request.project,
    results,
    problems: results
      .filter((result) => result.ok !== true)
      .map((result) => ({
        severity: "error",
        source: "rider-action",
        actionId: result.actionId,
        message: result.message ?? result.status ?? "Action did not invoke.",
      })),
    restartRecommended: !ok,
  };
}

function isMissingRestartEndpointError(message: string): boolean {
  return (
    message.includes("HTTP 404") ||
    message.includes("Unknown Pe.RiderBridge path")
  );
}

interface RiderBridgeSyncResult {
  ok: boolean;
  workflow: string;
  policy: "RrdRequired";
  cwd: string;
  executable: {
    requested: string;
    resolvedPath: string | null;
    source: "rider-bridge" | "missing";
  };
  commandLine: string | null;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  artifactPaths: string[];
  json?: unknown;
  runtimeFreshness?: {
    verdict?: string;
    loadedGraphVerdict?: string;
    sourceDeltaVerdict?: string;
    expectedRuntimeDelta?: boolean;
    basis?: string;
    nextStep?: string;
  };
  proof: {
    interpretation: string;
    proves: string;
    doesNotProve: string;
    nextStep: string | null;
  };
  guidance?: string;
}

async function mutateHotReloadSignalFile(signalPath: string): Promise<string> {
  const original = await readFile(signalPath, "utf-8");
  const stamp = Date.now().toString();
  const propertyPrefix = 'internal static string Value { get; } = "';
  const start = original.indexOf(propertyPrefix);
  let updated: string;
  if (start >= 0) {
    const valueStart = start + propertyPrefix.length;
    const valueEnd = original.indexOf('"', valueStart);
    updated =
      valueEnd >= 0
        ? `${original.slice(0, valueStart)}${stamp}${original.slice(valueEnd)}`
        : `${original.trimEnd()}\r\n// PE_HOT_RELOAD_SIGNAL ${stamp}\r\n`;
  } else {
    updated = `${original.trimEnd()}\r\n// PE_HOT_RELOAD_SIGNAL ${stamp}\r\n`;
  }

  await writeFile(signalPath, updated, "utf-8");
  return stamp;
}

async function requestRiderBridgeJson(
  url: string,
  method: "GET" | "POST",
  timeoutSeconds: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, { method, signal: controller.signal });
    const text = await response.text();
    const json = text.trim().length > 0 ? JSON.parse(text) : null;
    if (!response.ok)
      throw new Error(
        `Rider bridge ${method} ${url} returned HTTP ${response.status}: ${text}`,
      );
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function proofForRiderBridgeOperation(
  workflow: "sync" | "restart_rrd",
  ok: boolean,
  timedOut: boolean,
  response: RiderBridgeHotReloadResponse | null,
): RiderBridgeSyncResult["proof"] {
  const statuses =
    response?.results
      ?.map(
        (result) =>
          `${result.actionId ?? "unknown"}=${result.status ?? "unknown"}`,
      )
      .join(", ") ?? "no action results";
  const label = workflow === "restart_rrd" ? "restart_rrd" : "sync";
  return {
    interpretation: timedOut
      ? `RiderBridge ${label} timed out before Rider action results were returned.`
      : `RiderBridge ${label} ${ok ? "completed" : "failed"}; actions: ${statuses}.`,
    proves: ok
      ? workflow === "restart_rrd"
        ? "Rider accepted the localhost HTTP request, found the Pe.Tools project, and reported a restart/debug action invoked."
        : "Rider accepted the localhost HTTP request, found the Pe.Tools project, and reported the hot-reload action sequence invoked without pe-dev/AHK keyboard automation."
      : `RiderBridge did not provide a successful ${label} action sequence, so AttachedRrd freshness should not be trusted.`,
    doesNotProve:
      workflow === "restart_rrd"
        ? "Does not prove Revit finished launching, the Host/Revit bridge reconnected, or a document is ready. Poll host/session state before attached proof."
        : "Does not compare loaded assembly fingerprints or prove every source delta was applied; use an attached operation, Revit logs, or FreshRevitProcess when proof-grade behavior validation is needed.",
    nextStep: ok
      ? workflow === "restart_rrd"
        ? "Poll Pe.Host until the Revit bridge reconnects, then run an attached behavior/log proof."
        : "Run the attached Revit operation/script/test that needed sync and inspect behavior or logs."
      : "Check Rider, plugin install, project/debug context, then retry live_rrd_sync or restart RRD before attached proof.",
  };
}

function formatRiderBridgeProblems(
  response: RiderBridgeHotReloadResponse | null,
  prefix: string,
): string {
  const problems = response?.problems
    ?.map((problem) => {
      const source = problem.source ?? "rider";
      const action = problem.actionId ? ` ${problem.actionId}` : "";
      const message = problem.message ?? "unknown problem";
      return `${source}${action}: ${message}`;
    })
    .join("; ");
  return problems == null || problems.length === 0
    ? `${prefix}: ${JSON.stringify(response)}`
    : `${prefix}: ${problems}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

