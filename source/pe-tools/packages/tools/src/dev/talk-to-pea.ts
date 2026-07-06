import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ExecutionPolicy } from "./pe-revit-workflow/index.js";
import { runSdkLiveSync, sdkLiveWarning } from "./sdk-live.js";
import type {
  TalkToPeaFrame,
  TalkToPeaWorkerRequest,
  TalkToPeaWorkerResponse,
} from "./talk-to-pea-worker.js";

const defaultTimeoutSeconds = 900;
const workerResultPrefix = "__PEA_TALK_WORKER_RESULT__";
const logCursorStore = new Map<string, LogCursor>();

type LogCursorMode = "read" | "reset";

interface LogCursor {
  checkedAt: string;
  size: number;
  lineCount: number;
}

interface TalkToPeaRequest extends TalkToPeaWorkerRequest {}

export async function talkToPeaHarness(request: TalkToPeaRequest) {
  const startedAt = Date.now();
  const syncResult = await runSdkLiveSync({ timeoutSeconds: request.timeoutSeconds });
  const workerResponse = await runTalkToPeaWorkerProcess(request);

  return {
    ...workerResponse,
    workflow: "talk_to_pea",
    policy: "DiagnosticsOnly" satisfies ExecutionPolicy,
    elapsedMs: Date.now() - startedAt,
    liveSync: {
      ok: syncResult.ok,
      warning: sdkLiveWarning(syncResult),
      sync: syncResult,
    },
    proof: proofForTalkToPea(request.frame),
  };
}

function resolveTalkToPeaWorkerPath(): string {
  const jsWorkerPath = fileURLToPath(new URL("./talk-to-pea-worker.js", import.meta.url));
  if (existsSync(jsWorkerPath)) return jsWorkerPath;
  return fileURLToPath(new URL("./talk-to-pea-worker.ts", import.meta.url));
}

function resolveWorkerProcessArgs(workerPath: string): string[] {
  if (!workerPath.endsWith(".ts")) return [workerPath];
  const jitiPackagePath = fileURLToPath(import.meta.resolve("jiti/package.json"));
  return [join(dirname(jitiPackagePath), "lib", "jiti-cli.mjs"), workerPath];
}

async function runTalkToPeaWorkerProcess(
  request: TalkToPeaRequest,
): Promise<TalkToPeaWorkerResponse> {
  const workerPath = resolveTalkToPeaWorkerPath();
  // The worker arms its own graceful timer at timeoutSeconds (abort the run, report a
  // structured ok:false result with transcript/toolTrace). Give it 30s of grace before the
  // hard kill so the graceful path wins and the harness returns evidence instead of nothing.
  const timeoutMs = (Math.max(1, request.timeoutSeconds) + 30) * 1000;
  const child = spawn(process.execPath, resolveWorkerProcessArgs(workerPath), {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdin.end(JSON.stringify(request));

  return await new Promise<TalkToPeaWorkerResponse>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      settled = true;
      child.kill();
      const detail = [
        `Pea worker did not finish within ${request.timeoutSeconds} seconds (killed after +30s grace).`,
        stderr.trim() ? `worker stderr:\n${stderr.trim().slice(-4000)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      reject(new Error(detail));
    }, timeoutMs);

    function finishWithResponse(response: TalkToPeaWorkerResponse | { ok: false; error: string }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if ("error" in response) {
        reject(new Error(String(response.error)));
      } else {
        resolve(response);
      }
    }

    function finishWithError(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    }

    child.stdout.on("data", () => {
      const response = parseWorkerResponse(stdout);
      if (response) finishWithResponse(response);
    });
    child.on("error", finishWithError);
    child.on("exit", (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (timedOut) return;

      const response = parseWorkerResponse(stdout);
      if (response) {
        finishWithResponse(response);
        return;
      }

      const detail = [
        `Pea worker exited with code ${code ?? "unknown"}.`,
        stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
        stdout.trim() ? `stdout:\n${stdout.trim().slice(-4000)}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      finishWithError(new Error(detail));
    });
  });
}

function parseWorkerResponse(
  stdout: string,
): (TalkToPeaWorkerResponse | { ok: false; error: string }) | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(workerResultPrefix));
  if (!line) return null;

  const parsed: unknown = JSON.parse(line.slice(workerResultPrefix.length));
  return readWorkerResponse(parsed);
}

function readWorkerResponse(
  value: unknown,
): TalkToPeaWorkerResponse | { ok: false; error: string } {
  const record = readRecord(value);
  if (!record) throw new Error("Invalid Pea worker response.");
  if (record.ok === false && typeof record.error === "string") {
    return { ok: false, error: record.error };
  }
  if (record.ok !== true && record.ok !== false) throw new Error("Invalid Pea worker status.");
  if (typeof record.threadId !== "string") throw new Error("Invalid Pea worker thread id.");
  if (!isTalkToPeaFrame(record.frame)) throw new Error("Invalid Pea worker frame.");
  if (typeof record.latestResponse !== "string")
    throw new Error("Invalid Pea worker latest response.");
  if (typeof record.primaryResponse !== "string")
    throw new Error("Invalid Pea worker primary response.");
  if (record.feedbackResponse !== null && typeof record.feedbackResponse !== "string") {
    throw new Error("Invalid Pea worker feedback response.");
  }
  return {
    ok: record.ok,
    threadId: record.threadId,
    frame: record.frame,
    latestResponse: record.latestResponse,
    primaryResponse: record.primaryResponse,
    feedbackResponse: record.feedbackResponse,
    transcriptTail: readTranscriptTail(record.transcriptTail),
    toolTrace: Array.isArray(record.toolTrace) ? record.toolTrace : [],
  };
}

function readTranscriptTail(value: unknown): TalkToPeaWorkerResponse["transcriptTail"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = readRecord(entry);
    return record &&
      (record.role === "user" || record.role === "assistant") &&
      typeof record.text === "string"
      ? [{ role: record.role, text: record.text }]
      : [];
  });
}

function isTalkToPeaFrame(value: unknown): value is TalkToPeaFrame {
  return value === "operator" || value === "feedback" || value === "collaborate";
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proofForTalkToPea(frame: TalkToPeaFrame) {
  switch (frame) {
    case "feedback":
      return {
        interpretation: "Pea was asked for black-box feedback on its product/harness experience.",
        proves:
          "Whether Pea can articulate useful operator-facing friction, missing context, and harness affordance feedback from its own thread.",
        doesNotProve:
          "Source correctness, host operation schema correctness, or that Pea's suggested product changes are architecturally justified.",
        nextStep:
          "Use the feedback as design input, then verify concrete source/runtime changes with focused tools, scripts, or tests.",
      };
    case "collaborate":
      return {
        interpretation:
          "Pea was asked to collaborate on a live Revit/project convention investigation.",
        proves:
          "Whether Pea can explore project standards and strange conventions through the deployed product surface.",
        doesNotProve:
          "That observed conventions generalize across projects or that collector heuristics are complete/correct.",
        nextStep:
          "Treat findings as hypotheses for source design, then validate with targeted collectors, scripts, or Revit-backed tests.",
      };
    case "operator":
    default:
      return {
        interpretation: "Pea was asked to answer as the deployed user-facing Revit/operator agent.",
        proves:
          "Whether Pea can satisfy this operator request with the current Pea persona, context, and product tools.",
        doesNotProve:
          "Harness design quality by itself, source correctness, or deterministic Revit data coverage.",
        nextStep: "If the answer exposes friction, continue the same thread with frame='feedback'.",
      };
  }
}

export async function readLogTailSince(
  filePath: string,
  mode: LogCursorMode,
  maxLines = 200,
): Promise<{ text: string; cursor: LogCursor | null }> {
  const fs = await import("node:fs/promises");
  try {
    const stat = await fs.stat(filePath);
    const previous = logCursorStore.get(filePath);
    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const startLine =
      mode === "read" && previous && stat.size >= previous.size
        ? previous.lineCount
        : Math.max(0, lines.length - maxLines);
    const text = lines.slice(startLine).slice(-maxLines).join("\n");
    const cursor = {
      checkedAt: new Date().toISOString(),
      size: stat.size,
      lineCount: lines.length,
    };
    logCursorStore.set(filePath, cursor);
    return { text, cursor };
  } catch {
    return { text: "", cursor: null };
  }
}

export function defaultTalkToPeaRequest(
  partial: Partial<TalkToPeaRequest> & Pick<TalkToPeaRequest, "prompt">,
): TalkToPeaRequest {
  return {
    frame: partial.frame ?? "operator",
    prompt: partial.prompt,
    feedbackPrompt: partial.feedbackPrompt,
    reviewFrame: partial.reviewFrame,
    threadId: partial.threadId,
    timeoutSeconds: partial.timeoutSeconds ?? defaultTimeoutSeconds,
    maxMessages: partial.maxMessages ?? 12,
  };
}
