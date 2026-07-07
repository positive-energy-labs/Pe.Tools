import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { delimiter, extname, isAbsolute, resolve } from "node:path";

const defaultTimeoutSeconds = 900;
const outputTailLimit = 16_000;
const jsonCaptureLimit = 4_000_000;
const outerTimeoutCleanupGraceSeconds = 5;

export type ExecutionPolicy =
  | "NoRrdContact"
  | "DiagnosticsOnly"
  | "RrdRequired"
  | "FreshRevitProcess";

export type ExecutableSource = "path" | "absolute" | "missing";

interface WorkflowCommandRequest {
  workflow: string;
  policy: ExecutionPolicy;
  requestedExecutable: string;
  args: string[];
  timeoutSeconds: number;
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
}

export function runPeRevitWorkflow(
  workflow: string,
  args: string[],
  policy: ExecutionPolicy,
  timeoutSeconds = defaultTimeoutSeconds,
): Promise<WorkflowCommandResult> {
  return runWorkflowCommand({
    workflow,
    policy,
    requestedExecutable: "dotnet",
    args: ["tool", "run", "pe-revit", "--", ...args],
    timeoutSeconds,
  });
}

export async function runFreshRevitTest(request: {
  filter: string;
  project?: string;
  revitYear?: string;
  planOnly: boolean;
  timeoutSeconds: number;
}) {
  const args = [
    "test",
    "fresh",
    "--filter",
    request.filter,
    "--timeout-seconds",
    String(request.timeoutSeconds),
    "--json",
  ];
  if (request.project) args.push("--project", request.project);
  if (request.revitYear) args.push("--year", request.revitYear);
  if (request.planOnly) args.push("--plan");

  const result = await runPeRevitWorkflow(
    "test:FreshRevitProcess",
    args,
    "FreshRevitProcess",
    request.timeoutSeconds + 30,
  );

  return {
    ok: result.ok,
    workflow: "test:FreshRevitProcess",
    results: [result],
    sdkTest: result.json ?? result.stdoutTail,
  };
}

export async function runAttachedRrdTest(request: {
  filter: string;
  project?: string;
  revitYear?: string;
  syncFirst: boolean;
  timeoutSeconds: number;
}) {
  const args = [
    "test",
    "attached",
    "--filter",
    request.filter,
    "--timeout-seconds",
    String(request.timeoutSeconds),
    "--json",
  ];
  if (request.project) args.push("--project", request.project);
  if (request.revitYear) args.push("--year", request.revitYear);
  if (request.syncFirst) args.push("--sync");

  const result = await runPeRevitWorkflow(
    "test:attached",
    args,
    "RrdRequired",
    request.timeoutSeconds + 30,
  );

  return {
    ok: result.ok,
    workflow: "test:AttachedRrd",
    results: [result],
    sdkTest: result.json ?? result.stdoutTail,
  };
}

async function runWorkflowCommand(request: WorkflowCommandRequest): Promise<WorkflowCommandResult> {
  const cwd = process.cwd();
  const primary = await resolveExecutable(request.requestedExecutable);
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
    let stdoutForJson = "";
    let stderrTail = "";
    let timedOut = false;
    let settled = false;
    let forcedTimeout: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      stderrTail = appendTail(
        stderrTail,
        `\nCommand exceeded outer timeoutSeconds=${request.timeoutSeconds}; requested process-tree termination.\n`,
      );
      terminateChildProcessTree(child);
      forcedTimeout = setTimeout(() => {
        stderrTail = appendTail(
          stderrTail,
          `\nCommand did not emit close within ${outerTimeoutCleanupGraceSeconds}s after termination request; returning control while cleanup continues.\n`,
        );
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle(124);
      }, outerTimeoutCleanupGraceSeconds * 1000);
    }, request.timeoutSeconds * 1000);

    const settle = (exitCode: number | null, errorMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forcedTimeout) clearTimeout(forcedTimeout);

      if (errorMessage) stderrTail = appendTail(stderrTail, errorMessage);
      const durationMs = Date.now() - startedAt;
      const effectiveExitCode = exitCode ?? (timedOut ? 124 : -1);
      const resultTimedOut = timedOut || effectiveExitCode === 124;
      const ok = !resultTimedOut && effectiveExitCode === 0;
      const parsedJson = parseJsonObjectFromTail(stdoutForJson || stdoutTail);

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
        exitCode: effectiveExitCode,
        timedOut: resultTimedOut,
        durationMs,
        stdoutTail,
        stderrTail,
        artifactPaths: request.artifactPaths ?? [],
        json: parsedJson,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!settled) {
        const text = chunk.toString();
        stdoutTail = appendTail(stdoutTail, text);
        stdoutForJson = appendHead(stdoutForJson, text, jsonCaptureLimit);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (!settled) stderrTail = appendTail(stderrTail, chunk.toString());
    });
    child.on("error", (error) => settle(-1, error.message));
    child.on("close", (exitCode) => settle(exitCode));
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
      if (await isFile(candidate)) return { resolvedPath: candidate, source: "path" };
    }
  }

  return { resolvedPath: null, source: "missing" };
}

function getExecutableNames(requestedExecutable: string): string[] {
  if (process.platform !== "win32") return [requestedExecutable];

  if (extname(requestedExecutable).length > 0) return [requestedExecutable];

  const pathExt = (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".COM", ".EXE"]).filter(
    (extension) => ![".BAT", ".CMD"].includes(extension.toUpperCase()),
  );
  return [
    requestedExecutable,
    ...pathExt.map((extension) => `${requestedExecutable}${extension.toLowerCase()}`),
    ...pathExt.map((extension) => `${requestedExecutable}${extension.toUpperCase()}`),
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
  const displayPath = executablePath.includes(" ") ? resolve(executablePath) : executablePath;
  return [displayPath, ...args].map(quoteCommandPart).join(" ");
}

function quoteCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:\\=-]+$/.test(value)
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function parseJsonObjectFromTail(text: string): unknown {
  const trimmed = text.trim();
  const end = trimmed.lastIndexOf("}");
  if (end < 0) return undefined;

  for (
    let start = trimmed.lastIndexOf("{", end);
    start >= 0;
    start = trimmed.lastIndexOf("{", start - 1)
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
      return parsed;
    } catch {
      // Try the previous opening brace; SDK CLI JSON is pretty-printed.
    }
  }

  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendTail(current: string, next: string): string {
  const combined = current + next;
  return combined.length <= outputTailLimit
    ? combined
    : combined.slice(combined.length - outputTailLimit);
}

function appendHead(current: string, next: string, limit: number): string {
  return current.length >= limit ? current : (current + next).slice(0, limit);
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
    killer.unref();
    return;
  }

  child.kill("SIGTERM");
}
