import { spawn } from "node:child_process";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";

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

interface RiderLaunchResult {
  attempted: boolean;
  processAlreadyRunning: boolean;
  projectPath: string;
  executablePath?: string;
  executableSource?: string;
  pid?: number;
  projectOpenPolicy?: RiderProjectOpenPolicyResult;
  pingAfterLaunch?: unknown;
  reason: string;
  error?: string;
}

interface RiderProjectOpenPolicyResult {
  attempted: boolean;
  value: string;
  reason: string;
  updatedFiles: Array<{
    path: string;
    previousValue: string | null;
  }>;
  inspectedFiles: string[];
  skippedFiles: Array<{
    path: string;
    reason: string;
  }>;
}

interface RestartRrdInvocation {
  restart: RiderBridgeHotReloadResponse | null;
  fallbackError: string | null;
  projectOpenAttempt: RiderLaunchResult | null;
  attempts: Array<{
    attempt: number;
    retryable: boolean;
    reason: string;
    restart?: RiderBridgeHotReloadResponse | null;
    fallbackError?: string | null;
    error?: string;
    projectOpenAttempt?: RiderLaunchResult | null;
  }>;
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
  let riderLaunch: RiderLaunchResult | null = null;
  let restart: RiderBridgeHotReloadResponse | null = null;
  let fallbackError: string | null = null;
  let projectOpenAttempt: RiderLaunchResult | null = null;
  let restartAttempts: RestartRrdInvocation["attempts"] = [];

  try {
    try {
      ping = await requestRiderBridgeJson(
        `${bridgeBaseUrl}/pe-tools/ping`,
        "GET",
        Math.min(request.timeoutSeconds, 10),
      );
    } catch (error) {
      riderLaunch = await openPeToolsInRider({
        bridgeBaseUrl,
        initialPingError: formatUnknownError(error),
        repoRoot: request.repoRoot,
        timeoutSeconds: request.timeoutSeconds,
      });
      if (!riderLaunch.attempted || riderLaunch.pingAfterLaunch == null)
        throw new Error(riderLaunch.reason);
      ping = riderLaunch.pingAfterLaunch;
    }

    if (request.actionId == null && !supportsDirectRunConfigurationRestart(ping)) {
      throw new Error(
        "Pe.RiderBridge is stale or does not advertise direct run-configuration restart support. Reinstall the packaged Rider plugin from .artifacts/packages/rider/Pe.RiderBridge.0.1.0.zip and restart Rider before live_rrd_restart. Refusing to invoke generic Rider Debug because it can open Edit Configuration as a false success.",
      );
    }

    const invocation = await invokeRestartRrdWhenReady({
      bridgeBaseUrl,
      endpoint,
      request,
      timeoutSeconds: Math.min(request.timeoutSeconds, 120),
    });
    restart = invocation.restart;
    fallbackError = invocation.fallbackError;
    projectOpenAttempt = invocation.projectOpenAttempt;
    restartAttempts = invocation.attempts;

    const ok = restart?.ok === true;
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
      stdoutTail: JSON.stringify({ ping, riderLaunch, projectOpenAttempt, restart, fallbackError, restartAttempts }, null, 2),
      stderrTail: ok
        ? ""
        : formatRiderBridgeProblems(
          restart,
          "Rider bridge restart_rrd did not report a launched debug action",
        ),
      artifactPaths: [],
      json: { ping, riderLaunch, projectOpenAttempt, restart, fallbackError, restartAttempts, lane: "RiderBridge" },
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
        ? restart?.operation === "restart-rrd-fallback"
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
      stdoutTail: ping === undefined && riderLaunch == null && projectOpenAttempt == null ? "" : JSON.stringify({ ping, riderLaunch, projectOpenAttempt, restart, fallbackError, restartAttempts }, null, 2),
      stderrTail: formatUnknownError(error),
      artifactPaths: [],
      json: {
        ping,
        riderLaunch,
        restart,
        fallbackError,
        projectOpenAttempt,
        restartAttempts,
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

async function invokeRestartRrdWhenReady(request: {
  bridgeBaseUrl: string;
  endpoint: string;
  request: RiderBridgeRestartRrdRequest;
  timeoutSeconds: number;
}): Promise<RestartRrdInvocation> {
  const deadline = Date.now() + request.timeoutSeconds * 1000;
  const attempts: RestartRrdInvocation["attempts"] = [];
  let lastRestart: RiderBridgeHotReloadResponse | null = null;
  let lastFallbackError: string | null = null;
  let projectOpenAttempt: RiderLaunchResult | null = null;

  for (let attempt = 1; ; attempt++) {
    let restart: RiderBridgeHotReloadResponse | null = null;
    let fallbackError: string | null = null;
    try {
      restart = (await requestRiderBridgeJson(
        request.endpoint,
        "POST",
        30,
      )) as RiderBridgeHotReloadResponse;
    } catch (error) {
      fallbackError = formatUnknownError(error);
      if (isMissingRestartEndpointError(fallbackError)) {
        try {
          restart = await invokeRestartFallbackActions(
            request.bridgeBaseUrl,
            request.request,
            30,
          );
        } catch (fallbackActionError) {
          const actionError = formatUnknownError(fallbackActionError);
          if (isNoOpenMatchingProjectError(actionError) && projectOpenAttempt == null) {
            projectOpenAttempt = await openPeToolsInRider({
              bridgeBaseUrl: request.bridgeBaseUrl,
              initialPingError: actionError,
              repoRoot: request.request.repoRoot,
              timeoutSeconds: Math.min(request.timeoutSeconds, 90),
            });
          }
          const retryable = isRetryableRestartReadinessError(actionError, null);
          attempts.push({
            attempt,
            retryable,
            reason: actionError,
            fallbackError,
            error: actionError,
            projectOpenAttempt,
          });
          if (!retryable || Date.now() >= deadline)
            throw new Error(actionError);
          await delay(2_000);
          continue;
        }
      } else {
        if (isNoOpenMatchingProjectError(fallbackError) && projectOpenAttempt == null) {
          projectOpenAttempt = await openPeToolsInRider({
            bridgeBaseUrl: request.bridgeBaseUrl,
            initialPingError: fallbackError,
            repoRoot: request.request.repoRoot,
            timeoutSeconds: Math.min(request.timeoutSeconds, 90),
          });
        }
        const retryable = isRetryableRestartReadinessError(fallbackError, null);
        attempts.push({
          attempt,
          retryable,
          reason: fallbackError,
          fallbackError,
          error: fallbackError,
          projectOpenAttempt,
        });
        if (!retryable || Date.now() >= deadline) throw error;
        await delay(2_000);
        continue;
      }
    }

    const retryable = isRetryableRestartReadinessError(fallbackError, restart);
    const reason = restart?.ok === true
      ? "Restart/debug action invoked."
      : restart != null
        ? formatRiderBridgeProblems(
          restart,
          "Rider restart/debug action is not ready yet",
        )
        : fallbackError ?? "Rider restart/debug action is not ready yet.";
    attempts.push({
      attempt,
      retryable,
      reason,
      restart,
      fallbackError,
    });
    lastRestart = restart;
    lastFallbackError = fallbackError;

    if (restart?.ok === true || !retryable || Date.now() >= deadline) {
      return {
        restart: lastRestart,
        fallbackError: lastFallbackError,
        projectOpenAttempt,
        attempts,
      };
    }

    await delay(2_000);
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

function supportsDirectRunConfigurationRestart(ping: unknown): boolean {
  return (
    typeof ping === "object" &&
    ping != null &&
    "restartStrategy" in ping &&
    (ping as { restartStrategy?: unknown }).restartStrategy ===
      "rerun-action-then-debug-run-configuration"
  );
}

function isMissingRestartEndpointError(message: string): boolean {
  return message.includes("Unknown Pe.RiderBridge path");
}

function isNoOpenMatchingProjectError(message: string): boolean {
  return message.includes("No open matching project");
}

function isRetryableRestartReadinessError(
  message: string | null,
  restart: RiderBridgeHotReloadResponse | null,
): boolean {
  if (message != null && isNoOpenMatchingProjectError(message)) return true;
  if (restart?.ok === true) return false;

  const results = restart?.results;
  return results != null && results.length > 0 && results.every(
    (result) =>
      result.ok !== true &&
      (result.status === "disabled" ||
        result.status === "missing" ||
        result.status === "invalid-configuration" ||
        result.message?.includes("disabled for the current Rider context") === true),
  );
}

async function openPeToolsInRider(request: {
  bridgeBaseUrl: string;
  initialPingError: string;
  repoRoot: string;
  timeoutSeconds: number;
}): Promise<RiderLaunchResult> {
  const projectPath = resolve(request.repoRoot, "Pe.Tools.slnx");
  const processAlreadyRunning = await isRiderProcessRunning();
  const rider = await resolveRiderExecutable();
  if (rider.path == null) {
    return {
      attempted: false,
      processAlreadyRunning,
      projectPath,
      reason: `No Rider executable could be found to open ${projectPath}. Pe.RiderBridge/project readiness error: ${request.initialPingError}`,
    };
  }

  const projectOpenPolicy = await ensureRiderProjectsOpenInNewWindow();

  try {
    const child = spawn(rider.path, [projectPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    const pingAfterLaunch = await waitForRiderBridgePing(
      request.bridgeBaseUrl,
      Math.min(request.timeoutSeconds, 90),
    );
    return {
      attempted: true,
      processAlreadyRunning,
      projectPath,
      executablePath: rider.path,
      executableSource: rider.source,
      pid: child.pid,
      projectOpenPolicy,
      pingAfterLaunch,
      reason: processAlreadyRunning
        ? `Rider was already running, so ${projectPath} was opened/focused in Rider before retrying RRD startup/restart. Rider project-open policy was set to open new projects in a new window first to avoid modal prompts.`
        : `Rider was not running, so ${projectPath} was opened in Rider before requesting RRD startup/restart. Rider project-open policy was set to open new projects in a new window first to avoid modal prompts.`,
    };
  } catch (error) {
    return {
      attempted: true,
      processAlreadyRunning,
      projectPath,
      executablePath: rider.path,
      executableSource: rider.source,
      projectOpenPolicy,
      reason: `Rider launch/project-open ping recovery failed after opening ${projectPath}. Pe.RiderBridge/project readiness error: ${request.initialPingError}`,
      error: formatUnknownError(error),
    };
  }
}

async function ensureRiderProjectsOpenInNewWindow(): Promise<RiderProjectOpenPolicyResult> {
  const value = "0";
  const inspectedFiles: string[] = [];
  const updatedFiles: RiderProjectOpenPolicyResult["updatedFiles"] = [];
  const skippedFiles: RiderProjectOpenPolicyResult["skippedFiles"] = [];
  const appData = process.env.APPDATA;
  if (appData == null || appData.trim().length === 0) {
    return {
      attempted: false,
      value,
      inspectedFiles,
      updatedFiles,
      skippedFiles,
      reason: "APPDATA is not set, so Rider project-open preferences could not be inspected before launch.",
    };
  }

  const jetBrainsOptionsRoot = join(appData, "JetBrains");
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
  }>;
  try {
    entries = await readdir(jetBrainsOptionsRoot, { withFileTypes: true });
  } catch (error) {
    return {
      attempted: false,
      value,
      inspectedFiles,
      updatedFiles,
      skippedFiles: [{ path: jetBrainsOptionsRoot, reason: formatUnknownError(error) }],
      reason: "JetBrains settings root could not be read, so Rider project-open preferences could not be inspected before launch.",
    };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^Rider\d/.test(entry.name)) continue;

    const settingsPath = join(
      jetBrainsOptionsRoot,
      entry.name,
      "options",
      "ide.general.xml",
    );
    inspectedFiles.push(settingsPath);

    let original: string;
    try {
      original = await readFile(settingsPath, "utf-8");
    } catch (error) {
      skippedFiles.push({ path: settingsPath, reason: formatUnknownError(error) });
      continue;
    }

    const optionPattern = /(<option\s+name="confirmOpenNewProject2"\s+value=")([^"]*)("\s*\/>)/;
    const match = original.match(optionPattern);
    let updated: string;
    let previousValue: string | null = null;
    if (match != null) {
      previousValue = match[2] ?? null;
      if (previousValue === value) continue;
      updated = original.replace(optionPattern, `$1${value}$3`);
    } else if (original.includes('<component name="GeneralSettings">')) {
      updated = original.replace(
        '<component name="GeneralSettings">',
        `<component name="GeneralSettings">\r\n    <option name="confirmOpenNewProject2" value="${value}" />`,
      );
    } else {
      skippedFiles.push({
        path: settingsPath,
        reason: "GeneralSettings component was not found.",
      });
      continue;
    }

    await writeFile(settingsPath, updated, "utf-8");
    updatedFiles.push({ path: settingsPath, previousValue });
  }

  return {
    attempted: true,
    value,
    inspectedFiles,
    updatedFiles,
    skippedFiles,
    reason: updatedFiles.length > 0
      ? "Set Rider GeneralSettings.confirmOpenNewProject2=0 so command-line project opens choose a new window instead of showing the same-window/new-window modal."
      : "Rider GeneralSettings.confirmOpenNewProject2 was already set to open projects in a new window, or no Rider settings file was writable.",
  };
}

async function isRiderProcessRunning(): Promise<boolean> {
  if (process.platform === "win32") {
    for (const imageName of ["rider64.exe", "rider.exe"]) {
      const result = await runProcessCapture("tasklist.exe", [
        "/FI",
        `IMAGENAME eq ${imageName}`,
        "/FO",
        "CSV",
        "/NH",
      ]);
      if (result.exitCode === 0 && result.stdout.toLowerCase().includes(imageName))
        return true;
    }
    return false;
  }

  const result = await runProcessCapture("pgrep", ["-f", "Rider"]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function resolveRiderExecutable(): Promise<{
  path: string | null;
  source?: string;
}> {
  for (const [source, path] of [
    ["PE_RIDER_EXE", process.env.PE_RIDER_EXE],
    ["RIDER_EXE", process.env.RIDER_EXE],
    ["RIDER_PATH", process.env.RIDER_PATH],
  ] as const) {
    if (path != null && (await isFile(path))) return { path, source };
  }

  for (const executableName of getRiderExecutableNames()) {
    const path = await findExecutableOnPath(executableName);
    if (path != null) return { path, source: "PATH" };
  }

  const searchRoots = [
    process.env.LOCALAPPDATA == null
      ? null
      : join(process.env.LOCALAPPDATA, "JetBrains", "Toolbox", "apps", "Rider"),
    process.env.LOCALAPPDATA == null
      ? null
      : join(process.env.LOCALAPPDATA, "JetBrains", "Installations"),
    process.env.ProgramFiles == null
      ? null
      : join(process.env.ProgramFiles, "JetBrains"),
    process.env["ProgramFiles(x86)"] == null
      ? null
      : join(process.env["ProgramFiles(x86)"], "JetBrains"),
  ].filter((root): root is string => root != null);

  for (const root of searchRoots) {
    const path = await findRiderExecutableUnder(root, 7);
    if (path != null) return { path, source: root };
  }

  return { path: null };
}

function getRiderExecutableNames(): string[] {
  if (process.platform !== "win32") return ["rider"];

  const pathExtensions = process.env.PATHEXT?.split(";").filter(Boolean) ?? [
    ".EXE",
    ".BAT",
    ".CMD",
  ];
  return [
    "rider64.exe",
    "rider.exe",
    ...pathExtensions.map((extension) => `rider${extension.toLowerCase()}`),
    ...pathExtensions.map((extension) => `rider${extension.toUpperCase()}`),
    "rider",
  ];
}

async function waitForRiderBridgePing(
  bridgeBaseUrl: string,
  timeoutSeconds: number,
): Promise<unknown> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastError = "Pe.RiderBridge ping did not run.";
  do {
    try {
      return await requestRiderBridgeJson(
        `${bridgeBaseUrl}/pe-tools/ping`,
        "GET",
        5,
      );
    } catch (error) {
      lastError = formatUnknownError(error);
      await delay(2_000);
    }
  } while (Date.now() < deadline);

  throw new Error(`Timed out waiting for Rider/Pe.RiderBridge after launch: ${lastError}`);
}

async function findExecutableOnPath(name: string): Promise<string | null> {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (entry.trim().length === 0) continue;
    const candidate = resolve(entry, name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function findRiderExecutableUnder(
  root: string,
  maxDepth: number,
): Promise<string | null> {
  const matches: string[] = [];
  await collectRiderExecutables(root, maxDepth, matches);
  matches.sort().reverse();
  return matches[0] ?? null;
}

async function collectRiderExecutables(
  directory: string,
  depthRemaining: number,
  matches: string[],
): Promise<void> {
  if (depthRemaining < 0) return;

  let entries: Array<{
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && /^rider(64)?\.exe$/i.test(entry.name)) {
      matches.push(path);
      continue;
    }

    if (entry.isDirectory())
      await collectRiderExecutables(path, depthRemaining - 1, matches);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function runProcessCapture(
  executable: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveProcess) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { exitCode: number | null; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveProcess(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({
        exitCode: null,
        stdout,
        stderr: stderr || `Timed out after ${timeoutMs}ms running ${executable}`,
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ exitCode: -1, stdout, stderr: error.message });
    });
    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });
  });
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
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        `Timed out after ${timeoutSeconds}s waiting for Rider bridge ${method} ${url}`,
      );
    throw error;
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

