import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, resolve } from "node:path";
import {
  AttachedRrdFreshnessError,
  runWithAttachedRrdSync,
} from "../attached-rrd-sync.js";

const defaultTimeoutSeconds = 900;
const outputTailLimit = 16_000;
const peDevProjectPath = "source/Pe.Dev.Cli/Pe.Dev.Cli.csproj";

export type ExecutionPolicy =
  | "NoRrdContact"
  | "DiagnosticsOnly"
  | "RrdRequired"
  | "FreshRevitProcess";

export type ExecutableSource =
  | "path"
  | "absolute"
  | "repo-local-fallback"
  | "missing"
  | "direct-file-tail"
  | "rider-bridge";

interface SyncRuntimeFreshness {
  verdict?: string;
  loadedGraphVerdict?: string;
  sourceDeltaVerdict?: string;
  expectedRuntimeDelta?: boolean;
  basis?: string;
  loadedAssemblyCount?: number;
  comparableAssemblyCount?: number;
  staleAssemblyCount?: number;
  uncheckedAssemblyCount?: number;
  sourceDeltaCount?: number;
  initialFingerprint?: string;
  postFingerprint?: string;
  fingerprintChanged?: boolean;
  risks?: Array<{
    code?: string;
    severity?: string;
    detectability?: string;
    message?: string;
  }>;
  limits?: string[];
  nextStep?: string;
}

interface WorkflowCommandRequest {
  workflow: string;
  policy: ExecutionPolicy;
  requestedExecutable: string;
  args: string[];
  timeoutSeconds: number;
  fallback?: WorkflowCommandRequest;
  fallbackSource?: ExecutableSource;
  artifactPaths?: string[];
}

export interface WorkflowCommandResult {
  ok: boolean;
  workflow: string;
  policy: ExecutionPolicy;
  cwd: string;
  executable: {
    requested: string;
    resolvedPath: string | null;
    source: ExecutableSource;
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
  runtimeFreshness?: SyncRuntimeFreshness;
  proof: {
    interpretation: string;
    proves: string;
    doesNotProve: string;
    nextStep: string | null;
  };
  guidance?: string;
}

export function runPeDevWorkflow(
  workflow: string,
  args: string[],
  policy: ExecutionPolicy,
  timeoutSeconds = defaultTimeoutSeconds,
): Promise<WorkflowCommandResult> {
  return runWorkflowCommand(
    peDevWorkflowCommand(workflow, args, policy, timeoutSeconds),
  );
}

export function runRepoLocalPeDevWorkflow(
  workflow: string,
  args: string[],
  policy: ExecutionPolicy,
  timeoutSeconds = defaultTimeoutSeconds,
): Promise<WorkflowCommandResult> {
  return runWorkflowCommand(
    repoLocalPeDevWorkflowCommand(workflow, args, policy, timeoutSeconds),
  );
}

function peDevWorkflowCommand(
  workflow: string,
  args: string[],
  policy: ExecutionPolicy,
  timeoutSeconds: number,
): WorkflowCommandRequest {
  return {
    workflow,
    policy,
    requestedExecutable: "pe-dev",
    args,
    timeoutSeconds,
    fallbackSource: "repo-local-fallback",
    fallback: repoLocalPeDevWorkflowCommand(workflow, args, policy, timeoutSeconds),
  };
}

function repoLocalPeDevWorkflowCommand(
  workflow: string,
  args: string[],
  policy: ExecutionPolicy,
  timeoutSeconds: number,
): WorkflowCommandRequest {
  return {
    workflow,
    policy,
    requestedExecutable: "dotnet",
    args: [
      "run",
      "--project",
      resolveRepoLocalPeDevProjectPath(),
      "-c",
      "Debug.R25",
      "--",
      ...args,
    ],
    timeoutSeconds,
  };
}

function resolveRepoLocalPeDevProjectPath(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = resolve(directory, peDevProjectPath);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return resolve(process.cwd(), peDevProjectPath);
}

export async function runAttachedRrdTest(request: {
  filter: string;
  syncFirst: boolean;
  timeoutSeconds: number;
}) {
  const results: WorkflowCommandResult[] = [];
  if (request.syncFirst) {
    try {
      const synced = await runWithAttachedRrdSync(
        {
          workflow: "test:AttachedRrd",
          stalePolicy: "fail",
          timeoutSeconds: request.timeoutSeconds,
        },
        async () => null,
      );
      results.push(synced.sync);
    } catch (error) {
      if (error instanceof AttachedRrdFreshnessError) {
        results.push(error.syncResult);
        return { ok: false, workflow: "test:AttachedRrd", results };
      }
      throw error;
    }
  }

  const commands: WorkflowCommandRequest[] = [
    {
      workflow: "test:attached-build",
      policy: "NoRrdContact",
      requestedExecutable: "dotnet",
      args: [
        "build",
        "source/Pe.Revit.Tests/Pe.Revit.Tests.csproj",
        "-c",
        "Debug.R25.Tests",
        "/p:WarningLevel=0",
      ],
      timeoutSeconds: request.timeoutSeconds,
    },
    {
      workflow: "test:attached-run",
      policy: "RrdRequired",
      requestedExecutable: "dotnet",
      args: [
        "test",
        "source/Pe.Revit.Tests/Pe.Revit.Tests.csproj",
        "-c",
        "Debug.R25.Tests",
        "--filter",
        request.filter,
        "--no-build",
      ],
      timeoutSeconds: request.timeoutSeconds,
    },
  ];

  for (const command of commands) {
    const result = await runWorkflowCommand(command);
    results.push(result);
    if (!result.ok) break;
  }

  return {
    ok:
      results.length === commands.length + (request.syncFirst ? 1 : 0) &&
      results.every((result) => result.ok),
    workflow: "test:AttachedRrd",
    results,
  };
}

async function runWorkflowCommand(
  request: WorkflowCommandRequest,
): Promise<WorkflowCommandResult> {
  const cwd = process.cwd();
  const primary = await resolveExecutable(request.requestedExecutable);
  if (!primary.resolvedPath && request.fallback) {
    const fallback = await runWorkflowCommand(request.fallback);
    return {
      ...fallback,
      executable: {
        ...fallback.executable,
        source: request.fallbackSource ?? fallback.executable.source,
      },
      artifactPaths: request.artifactPaths ?? fallback.artifactPaths,
      proof: proofForResult(
        request.workflow,
        request.policy,
        fallback.ok,
        fallback.timedOut,
        fallback.json,
      ),
      guidance: `Primary executable '${request.requestedExecutable}' was not found on PATH; used repo-local fallback '${fallback.commandLine}'.`,
    };
  }

  if (!primary.resolvedPath) {
    return {
      ok: false,
      workflow: request.workflow,
      policy: request.policy,
      cwd,
      executable: {
        requested: request.requestedExecutable,
        resolvedPath: null,
        source: "missing",
      },
      commandLine: null,
      args: request.args,
      exitCode: -1,
      timedOut: false,
      durationMs: 0,
      stdoutTail: "",
      stderrTail: `Executable '${request.requestedExecutable}' was not found on PATH.`,
      artifactPaths: request.artifactPaths ?? [],
      proof: proofForResult(request.workflow, request.policy, false, false),
      guidance:
        request.requestedExecutable === "pe-dev"
          ? `Build Pe.Dev.Cli or use the repo-local fallback: dotnet run --project ${peDevProjectPath} -c Debug.R25 -- ${request.args.join(" ")}`
          : undefined,
    };
  }

  return spawnWorkflowCommand(request, primary.resolvedPath, primary.source);
}

async function spawnWorkflowCommand(
  request: WorkflowCommandRequest,
  executablePath: string,
  executableSource: ExecutableSource,
): Promise<WorkflowCommandResult> {
  const cwd = process.cwd();
  const startedAt = Date.now();
  const commandLine = formatCommandLine(executablePath, request.args);

  return new Promise((resolvePromise) => {
    const child = spawn(executablePath, request.args, {
      cwd,
      env: {
        ...process.env,
        MSBUILDDISABLENODEREUSE: "1",
      },
      windowsHide: true,
      shell: false,
    });

    let stdoutTail = "";
    let stderrTail = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChildProcessTree(child);
    }, request.timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutTail = appendTail(stdoutTail, chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk.toString());
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      resolvePromise({
        ok: false,
        workflow: request.workflow,
        policy: request.policy,
        cwd,
        executable: {
          requested: request.requestedExecutable,
          resolvedPath: executablePath,
          source: executableSource,
        },
        commandLine,
        args: request.args,
        exitCode: -1,
        timedOut,
        durationMs,
        stdoutTail,
        stderrTail: appendTail(stderrTail, error.message),
        artifactPaths: request.artifactPaths ?? [],
        proof: proofForResult(
          request.workflow,
          request.policy,
          false,
          timedOut,
        ),
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      const ok = exitCode === 0;
      const parsedJson = parseJsonObjectFromTail(stdoutTail);
      const runtimeFreshness = getSyncRuntimeFreshness(parsedJson);
      resolvePromise({
        ok,
        workflow: request.workflow,
        policy: request.policy,
        cwd,
        executable: {
          requested: request.requestedExecutable,
          resolvedPath: executablePath,
          source: executableSource,
        },
        commandLine,
        args: request.args,
        exitCode,
        timedOut,
        durationMs,
        stdoutTail,
        stderrTail,
        artifactPaths: request.artifactPaths ?? [],
        json: parsedJson,
        runtimeFreshness,
        proof: proofForResult(
          request.workflow,
          request.policy,
          ok,
          timedOut,
          parsedJson,
        ),
      });
    });
  });
}

export async function resolveExecutable(
  requestedExecutable: string,
): Promise<{ resolvedPath: string | null; source: ExecutableSource }> {
  if (
    isAbsolute(requestedExecutable) ||
    requestedExecutable.includes("/") ||
    requestedExecutable.includes("\\")
  ) {
    const absolutePath = resolve(requestedExecutable);
    return (await isFile(absolutePath))
      ? { resolvedPath: absolutePath, source: "absolute" }
      : { resolvedPath: null, source: "missing" };
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry.trim().length > 0);
  const executableNames = getExecutableNames(requestedExecutable);
  for (const pathEntry of pathEntries) {
    for (const executableName of executableNames) {
      const candidate = resolve(pathEntry, executableName);
      if (await isFile(candidate))
        return { resolvedPath: candidate, source: "path" };
    }
  }

  return { resolvedPath: null, source: "missing" };
}

function getExecutableNames(requestedExecutable: string): string[] {
  if (process.platform !== "win32") return [requestedExecutable];

  if (extname(requestedExecutable).length > 0) return [requestedExecutable];

  const pathExt = process.env.PATHEXT?.split(";").filter(Boolean) ?? [
    ".COM",
    ".EXE",
    ".BAT",
    ".CMD",
  ];
  return [
    requestedExecutable,
    ...pathExt.map(
      (extension) => `${requestedExecutable}${extension.toLowerCase()}`,
    ),
    ...pathExt.map(
      (extension) => `${requestedExecutable}${extension.toUpperCase()}`,
    ),
  ];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function formatCommandLine(executablePath: string, args: string[]): string {
  const displayPath = executablePath.includes(" ")
    ? resolve(executablePath)
    : executablePath;
  return [displayPath, ...args].map(quoteCommandPart).join(" ");
}

function quoteCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:\\=-]+$/.test(value)
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function parseJsonObjectFromTail(text: string): unknown {
  for (const line of text.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {}
  }

  return undefined;
}

function getSyncRuntimeFreshness(
  parsedJson: unknown,
): SyncRuntimeFreshness | undefined {
  if (!isRecord(parsedJson)) return undefined;

  const runtimeFreshness = parsedJson.runtimeFreshness;
  return isRecord(runtimeFreshness)
    ? (runtimeFreshness as SyncRuntimeFreshness)
    : undefined;
}

function proofForSyncRuntimeFreshness(
  ok: boolean,
  timedOut: boolean,
  freshness: SyncRuntimeFreshness,
): WorkflowCommandResult["proof"] {
  const verdict =
    typeof freshness.verdict === "string" ? freshness.verdict : "unproven";
  const basis =
    typeof freshness.basis === "string"
      ? freshness.basis
      : "No runtime freshness basis was reported.";
  const nextStep =
    typeof freshness.nextStep === "string"
      ? freshness.nextStep
      : "Use live_loop_context log evidence or FreshRevitProcess proof before relying on attached behavior.";
  const loadedGraph =
    typeof freshness.loadedGraphVerdict === "string"
      ? freshness.loadedGraphVerdict
      : "unknown";
  const sourceDelta =
    typeof freshness.sourceDeltaVerdict === "string"
      ? freshness.sourceDeltaVerdict
      : "unknown";
  const counts = `loaded=${freshness.loadedAssemblyCount ?? "unknown"} comparable=${freshness.comparableAssemblyCount ?? "unknown"} stale=${freshness.staleAssemblyCount ?? "unknown"} unchecked=${freshness.uncheckedAssemblyCount ?? "unknown"} sourceDeltas=${freshness.sourceDeltaCount ?? "unknown"}`;
  const interpretation = timedOut
    ? `sync timed out before AttachedRrd runtime freshness could be proven (${counts}).`
    : `sync ${ok ? "completed" : "failed"}; AttachedRrd runtime freshness verdict=${verdict} loadedGraph=${loadedGraph} sourceDelta=${sourceDelta} (${counts}). ${basis}`;

  if (verdict === "fresh") {
    return {
      interpretation,
      proves:
        "The post-sync loaded Pe/Toon assembly graph matches disk and no runtime source delta is unproven in the sync contract, so AttachedRrd is fresh for the reported evidence.",
      doesNotProve:
        "Does not prove Rider applied every non-hot-reloadable member-shape, WPF/BAML/resource, restart-required change, or behavior path not represented by the sync evidence; FreshRevitProcess remains the proof lane when the current live session is not required.",
      nextStep,
    };
  }

  if (verdict === "stale") {
    return {
      interpretation,
      proves:
        "The sync report directly detected stale loaded runtime assemblies after Rider reload/apply automation.",
      doesNotProve:
        "Attached scripts/tests are not reliable freshness proof until the stale graph is resolved.",
      nextStep,
    };
  }

  return {
    interpretation,
    proves:
      "Sync ran but could not prove AttachedRrd loaded-runtime freshness from the available Host/Revit evidence.",
    doesNotProve:
      "Does not prove RRD is fresh. Do not treat attached scripts/tests as proof-grade while the verdict is unproven.",
    nextStep,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proofForResult(
  workflow: string,
  policy: ExecutionPolicy,
  ok: boolean,
  timedOut: boolean,
  parsedJson?: unknown,
): WorkflowCommandResult["proof"] {
  const runtimeFreshness = getSyncRuntimeFreshness(parsedJson);
  if (workflow === "sync" && runtimeFreshness)
    return proofForSyncRuntimeFreshness(ok, timedOut, runtimeFreshness);

  const interpretation = timedOut
    ? `${workflow} timed out under ${policy}. Treat the result as inconclusive until logs or a narrower command explain the hang.`
    : ok
      ? `${workflow} completed successfully under ${policy}.`
      : `${workflow} failed under ${policy}. Use the exit code and output tails as the next debugging evidence.`;

  switch (policy) {
    case "NoRrdContact":
      return {
        interpretation,
        proves: ok
          ? "Compile/package command completed without touching RRD by policy."
          : "Failure is from the isolated compile/package path, not proof of live RRD behavior.",
        doesNotProve:
          "Does not prove Rider hot reload, AttachedRrd freshness, or loaded Revit assembly state.",
        nextStep: ok
          ? null
          : "Fix the compile/package failure, then rerun the same command before any live runtime proof.",
      };
    case "DiagnosticsOnly":
      return {
        interpretation,
        proves: ok
          ? "Diagnostics command returned current live-loop state evidence."
          : "Diagnostics failed or was unavailable; live-loop state remains uncertain.",
        doesNotProve:
          "Does not compile, package, refresh, or validate product behavior by itself.",
        nextStep: ok
          ? "Use the returned state to choose source proof, live_rrd_sync, tests, or Pea product probes."
          : "Check tool availability and included log evidence, then rerun diagnostics.",
      };
    case "RrdRequired":
      return {
        interpretation,
        proves: ok
          ? "RRD-required command completed, so attached validation can proceed if the prior IDE/Rider build was correct."
          : "RRD-required command failed; do not trust AttachedRrd scripts/tests as fresh.",
        doesNotProve:
          "Does not prove isolated package output and does not replace the IDE/Rider build that produces package-local runtime DLLs.",
        nextStep: ok
          ? "Run the attached script/test/product probe that needed RRD freshness."
          : "Inspect live_loop_context evidence and recover sync before attached validation.",
      };
    case "FreshRevitProcess":
      return {
        interpretation,
        proves: ok
          ? "FreshRevitProcess proof completed without reusing RRD."
          : "FreshRevitProcess proof failed or timed out; inspect output/logs before retrying broad tests.",
        doesNotProve:
          "Does not prove the current Rider-driven RRD session has fresh loaded assemblies.",
        nextStep: ok
          ? null
          : "Use the focused failure output and logs to narrow the test or runtime load problem.",
      };
  }
}

function appendTail(current: string, next: string): string {
  const combined = current + next;
  return combined.length <= outputTailLimit
    ? combined
    : combined.slice(combined.length - outputTailLimit);
}

function terminateChildProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) {
    child.kill();
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }

  child.kill("SIGTERM");
}
