import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

const defaultStartupDelayMs = 7000;
const defaultPostSubmitDelayMs = 2500;
const defaultTimeoutSeconds = 90;
const screenTailLimit = 12000;

export type PecoMuxDirection = "right" | "down";

export interface TalkToPecoMuxRequest {
  prompt?: string;
  cwd?: string;
  direction?: PecoMuxDirection;
  startupDelayMs?: number;
  postSubmitDelayMs?: number;
  timeoutSeconds?: number;
  dumpScreen?: boolean;
  dumpFullScrollback?: boolean;
}

export interface TalkToPecoPsmuxRequest extends TalkToPecoMuxRequest {
  sessionName?: string;
  attachInZellij?: boolean;
}

export async function talkToPecoZellij(request: TalkToPecoMuxRequest = {}) {
  const startedAt = Date.now();
  const cwd = await resolveRepoRoot(request.cwd ?? process.cwd());
  const timeoutSeconds = request.timeoutSeconds ?? defaultTimeoutSeconds;
  const direction = request.direction ?? "right";

  const launch = await runProcess(
    "zellij",
    [
      "action",
      "new-pane",
      "--direction",
      direction,
      "--cwd",
      cwd,
      "--name",
      "peco-zellij-poc",
      "--",
      "powershell",
      "-NoExit",
      "-Command",
      pecoPanePowerShellCommand(),
    ],
    { cwd, timeoutSeconds },
  );
  const paneId = parseZellijPaneId(launch.stdout);
  if (!paneId) {
    throw new Error(`zellij did not report a created terminal pane id. stdout:\n${launch.stdout}`);
  }

  await delay(request.startupDelayMs ?? defaultStartupDelayMs);
  const promptSent = await sendPromptToZellijPane(paneId, request.prompt, timeoutSeconds);
  if (promptSent) await delay(request.postSubmitDelayMs ?? defaultPostSubmitDelayMs);

  const screen =
    request.dumpScreen === false
      ? undefined
      : await dumpZellijPane(paneId, request.dumpFullScrollback ?? false, timeoutSeconds);

  return {
    ok: true,
    workflow: "talk_to_peco_zellij",
    mux: "zellij",
    paneId,
    cwd,
    direction,
    promptSent,
    elapsedMs: Date.now() - startedAt,
    command: "pnpm -C source/pe-tools --filter @pe/peco exec bun src/main.ts",
    proof: {
      inputPath:
        "zellij action write-chars --pane-id <pane> + zellij action send-keys --pane-id <pane> Enter",
      interpretation:
        "A second peco TUI was opened in a zellij pane and, when prompt is provided, text was injected through zellij's terminal input path rather than a headless worker API.",
      doesNotProve:
        "That the model completed the answer; use the visible pane or dumped screen as conversational evidence.",
    },
    screen,
  };
}

export async function talkToPecoPsmux(request: TalkToPecoPsmuxRequest = {}) {
  const startedAt = Date.now();
  const cwd = await resolveRepoRoot(request.cwd ?? process.cwd());
  const timeoutSeconds = request.timeoutSeconds ?? defaultTimeoutSeconds;
  const direction = request.direction ?? "right";
  const sessionName = sanitizeTmuxSessionName(request.sessionName ?? "peco-mux-poc");

  let paneId: string;
  let sessionCreated = false;
  let zellijAttachmentPaneId: string | undefined;
  if (process.env.TMUX) {
    const split = await runProcess(
      "tmux",
      [
        "split-window",
        direction === "down" ? "-v" : "-h",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        cwd,
        'powershell -NoExit -Command "' +
          escapeForPowerShellDoubleQuoted(pecoPanePowerShellCommand()) +
          '"',
      ],
      { cwd, timeoutSeconds },
    );
    paneId = parseTmuxPaneId(split.stdout);
  } else {
    const hasSession = await runProcessAllowFailure("tmux", ["has-session", "-t", sessionName], {
      cwd,
      timeoutSeconds,
    });
    if (hasSession.exitCode !== 0) {
      await runProcess(
        "tmux",
        ["new-session", "-d", "-s", sessionName, "-c", cwd, "powershell -NoExit"],
        { cwd, timeoutSeconds },
      );
      sessionCreated = true;
    }

    const split = await runProcess(
      "tmux",
      [
        "split-window",
        direction === "down" ? "-v" : "-h",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        `${sessionName}:0`,
        "-c",
        cwd,
        'powershell -NoExit -Command "' +
          escapeForPowerShellDoubleQuoted(pecoPanePowerShellCommand()) +
          '"',
      ],
      { cwd, timeoutSeconds },
    );
    paneId = parseTmuxPaneId(split.stdout);

    if (request.attachInZellij ?? Boolean(process.env.ZELLIJ)) {
      const attach = await runProcessAllowFailure(
        "zellij",
        [
          "action",
          "new-pane",
          "--direction",
          "down",
          "--cwd",
          cwd,
          "--name",
          `psmux-${sessionName}`,
          "--",
          "tmux",
          "attach-session",
          "-t",
          sessionName,
        ],
        { cwd, timeoutSeconds },
      );
      zellijAttachmentPaneId = parseZellijPaneId(attach.stdout) ?? undefined;
    }
  }

  if (!paneId) throw new Error("tmux did not report a created pane id.");

  await delay(request.startupDelayMs ?? defaultStartupDelayMs);
  const promptSent = await sendPromptToTmuxPane(paneId, request.prompt, timeoutSeconds);
  if (promptSent) await delay(request.postSubmitDelayMs ?? defaultPostSubmitDelayMs);

  const screen =
    request.dumpScreen === false
      ? undefined
      : await captureTmuxPane(paneId, request.dumpFullScrollback ?? false, timeoutSeconds);

  return {
    ok: true,
    workflow: "talk_to_peco_psmux",
    mux: "psmux/tmux",
    paneId,
    sessionName: process.env.TMUX ? undefined : sessionName,
    sessionCreated,
    zellijAttachmentPaneId,
    cwd,
    direction,
    promptSent,
    elapsedMs: Date.now() - startedAt,
    command: "pnpm -C source/pe-tools --filter @pe/peco exec bun src/main.ts",
    proof: {
      inputPath: "tmux send-keys -l -t <pane> <prompt> + tmux send-keys -t <pane> Enter",
      interpretation:
        "A second peco TUI was opened in a psmux/tmux pane and, when prompt is provided, text was injected through tmux key sending rather than a headless worker API.",
      doesNotProve:
        "That the model completed the answer; use the attached session/pane or captured pane text as conversational evidence.",
    },
    screen,
  };
}

async function sendPromptToZellijPane(
  paneId: string,
  prompt: string | undefined,
  timeoutSeconds: number,
): Promise<boolean> {
  if (!prompt?.trim()) return false;
  await runProcess("zellij", ["action", "write-chars", "--pane-id", paneId, prompt], {
    timeoutSeconds,
  });
  await runProcess("zellij", ["action", "send-keys", "--pane-id", paneId, "Enter"], {
    timeoutSeconds,
  });
  return true;
}

async function sendPromptToTmuxPane(
  paneId: string,
  prompt: string | undefined,
  timeoutSeconds: number,
): Promise<boolean> {
  if (!prompt?.trim()) return false;
  await runProcess("tmux", ["send-keys", "-t", paneId, "-l", prompt], { timeoutSeconds });
  await runProcess("tmux", ["send-keys", "-t", paneId, "Enter"], { timeoutSeconds });
  return true;
}

async function dumpZellijPane(
  paneId: string,
  full: boolean,
  timeoutSeconds: number,
): Promise<string> {
  const args = ["action", "dump-screen", "--pane-id", paneId];
  if (full) args.push("--full");
  const dump = await runProcess("zellij", args, { timeoutSeconds });
  return tailText(dump.stdout);
}

async function captureTmuxPane(
  paneId: string,
  full: boolean,
  timeoutSeconds: number,
): Promise<string> {
  const args = ["capture-pane", "-p", "-t", paneId];
  if (full) args.push("-S", "-");
  else args.push("-S", "-200");
  const capture = await runProcess("tmux", args, { timeoutSeconds });
  return tailText(capture.stdout);
}

function pecoPanePowerShellCommand(): string {
  return [
    "$Host.UI.RawUI.WindowTitle = 'peco mux agent'",
    "Write-Host '[peco mux pane] starting peco TUI...'",
    "pnpm -C source/pe-tools --filter @pe/peco exec bun src/main.ts",
  ].join("; ");
}

async function resolveRepoRoot(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  while (true) {
    const entries = await readDirectoryNames(current);
    if (entries.some((entry) => entry.endsWith(".slnx") || entry.endsWith(".sln"))) return current;
    if (entries.includes(".git")) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

async function readDirectoryNames(directory: string): Promise<string[]> {
  try {
    await access(directory);
    return await readdir(directory);
  } catch {
    return [];
  }
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutSeconds: number },
): Promise<ProcessResult> {
  const result = await runProcessAllowFailure(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.exitCode ?? "unknown"}.\n` +
        (result.stderr.trim() ? `stderr:\n${result.stderr.trim()}\n` : "") +
        (result.stdout.trim() ? `stdout:\n${result.stdout.trim()}\n` : ""),
    );
  }
  return result;
}

function runProcessAllowFailure(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutSeconds: number },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => {
        child.kill();
        reject(new Error(`${command} timed out after ${options.timeoutSeconds} seconds.`));
      },
      Math.max(1, options.timeoutSeconds) * 1000,
    );

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function parseZellijPaneId(stdout: string): string | null {
  return stdout.match(/terminal_\d+/)?.[0] ?? null;
}

function parseTmuxPaneId(stdout: string): string {
  return stdout.match(/%\d+/)?.[0] ?? stdout.trim().split(/\s+/)[0] ?? "";
}

function sanitizeTmuxSessionName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "peco-mux-poc";
}

function escapeForPowerShellDoubleQuoted(value: string): string {
  return value.replace(/`/g, "``").replace(/\$/g, "`$").replace(/"/g, '`"');
}

function tailText(value: string): string {
  if (value.length <= screenTailLimit) return value;
  return value.slice(value.length - screenTailLimit);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
