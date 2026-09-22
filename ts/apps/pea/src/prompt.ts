/**
 * `pea --prompt` — one headless Pea turn per invocation.
 *
 * Builds a fresh headless Pea runtime (the same product tools, skills, storage, and memory
 * profile as the interactive TUI), sends a single prompt, prints `{ threadId, response }`,
 * and exits. `--thread <id>` continues an existing Pea thread; `--json` prints the result as
 * JSON on stdout. Relocated from the old peco `talk_to_pea` worker; the MCP toolset stays
 * agent-free and harnesses talk to Pea through this CLI mode instead.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MastraDBMessage } from "@mastra/core/agent-controller";
import { resolvePeaProductHomePath } from "@pe/mcps";
import { createPeaRuntime, type PeaRuntimeHandle } from "@pe/runtime/pea";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { productRoot } from "@pe/host-contracts/service-identity";
import {
  checkoutLayout,
  checkoutRootFrom,
  sourceHostServiceName,
  sourceRootVariable,
} from "@pe/host-contracts/service-identity";
import { ensureRunning } from "@pe/host-contracts/pe-service";

const runtimeCloseTimeoutMs = 5000;
const sourceHostStartupTimeoutMs = 45_000;
export const defaultPeaPromptTimeoutSeconds = 900;

// Progress breadcrumbs on stderr: off by default so `pea --prompt --json` stays pipe-clean.
// Set PEA_PROMPT_TRACE=1 to locate a stuck await on timeout.
const traceEnabled = process.env.PEA_PROMPT_TRACE === "1";

function trace(message: string): void {
  if (!traceEnabled) return;
  process.stderr.write(`[pea-prompt ${new Date().toISOString()}] ${message}\n`);
}

const tracedEventTypes = new Set([
  "agent_start",
  "agent_end",
  "tool_start",
  "tool_end",
  "tool_approval_required",
  "tool_suspended",
  "error",
  "info",
]);

function traceSessionEvents(session: PeaPromptSession): void {
  session.subscribe?.((event) => {
    const record = readRecord(event);
    const type = typeof record?.type === "string" ? record.type : "";
    if (!tracedEventTypes.has(type)) return;
    const toolName = typeof record?.toolName === "string" ? ` tool=${record.toolName}` : "";
    trace(`event ${type}${toolName}`);
  });
}

type PeaPromptRuntime = PeaRuntimeHandle & {
  session: PeaPromptSession;
};

type PeaPromptMessage = Pick<MastraDBMessage, "id" | "role" | "content">;

type PeaPromptSession = {
  thread: {
    switch(request: { threadId: string }): Promise<void>;
    create(request: { title: string }): Promise<{ id: string }>;
    listActiveMessages(request?: { limit?: number }): Promise<PeaPromptMessage[]>;
  };
  sendMessage(request: { content: string }): Promise<void>;
  abort(): void;
  subscribe?(listener: (event: unknown) => void): () => void;
};

export interface PeaPromptRequest {
  prompt: string;
  threadId?: string;
  json?: boolean;
  timeoutSeconds?: number;
  workspaceRoot?: string;
}

export interface PeaPromptResult {
  ok: boolean;
  threadId: string;
  response: string;
}

/** Run one headless prompt, print the result, and return the process exit code. */
export async function runPeaPrompt(request: PeaPromptRequest): Promise<number> {
  let result: PeaPromptResult;
  try {
    result = await runPeaPromptTurn(request);
  } catch (error) {
    result = {
      ok: false,
      threadId: request.threadId ?? "",
      response: error instanceof Error ? error.message : String(error),
    };
  }

  if (request.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${result.response}\n`);
    process.stdout.write(`threadId: ${result.threadId || "(none)"}\n`);
  }

  return result.ok ? 0 : 1;
}

export async function runPeaPromptTurn(request: PeaPromptRequest): Promise<PeaPromptResult> {
  const timeoutSeconds = request.timeoutSeconds ?? defaultPeaPromptTimeoutSeconds;
  trace("creating runtime");
  const runtime = await createPeaPromptRuntime(request);
  trace("runtime ready");
  traceSessionEvents(runtime.session);
  try {
    const thread = request.threadId
      ? (await runtime.session.thread.switch({ threadId: request.threadId }),
        { id: request.threadId })
      : await runtime.session.thread.create({ title: "Pea prompt" });
    trace(`thread ready id=${thread.id}`);

    const turn = await sendPeaMessageWithTimeout(runtime.session, request.prompt, timeoutSeconds);
    return {
      ok: turn.ok,
      threadId: thread.id,
      response: turn.latestAssistantText,
    };
  } finally {
    await closeRuntimeBestEffort(runtime);
  }
}

async function closeRuntimeBestEffort(runtime: PeaPromptRuntime): Promise<void> {
  if (!runtime.close) return;

  try {
    await withTimeout(runtime.close(), runtimeCloseTimeoutMs);
  } catch {
    runtime.session.abort();
  }
}

function withTimeout<T>(task: Promise<T> | T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
  });

  return Promise.race([Promise.resolve(task), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function createPeaPromptRuntime(request: PeaPromptRequest): Promise<PeaPromptRuntime> {
  const workspaceRoot = path.resolve(request.workspaceRoot ?? resolvePeaProductHomePath());
  const hostBaseUrl = await ensureTsHostRunning();
  const handle = await createPeaRuntime({
    workspaceRoot,
    hostBaseUrl,
    protocol: "test",
    accessLevel: "trusted",
    capabilities: { revit: true },
  });
  if (!handle.session) throw new Error("Expected Pea prompt runtime session.");
  return handle as PeaPromptRuntime;
}

async function ensureTsHostRunning(): Promise<string> {
  const explicit = process.env[hostProcessIdentity.hostBaseUrlVariable]?.trim();
  if (explicit) return explicit;

  // An installed caller must supervise the installed incarnation even when a healthy dev host
  // currently owns the preferred port. The service primitive performs the authenticated takeover.
  const installed = await resolveInstalledHostLaunch();
  if (installed) {
    const result = await ensureRunning(installed.appBase, hostProcessIdentity.serviceName, {
      entryPath: installed.entryPath,
      health: hostProcessIdentity.healthPath,
      shutdown: hostProcessIdentity.shutdownPath,
      lane: "installed",
    });
    if (result.state === "failed") {
      throw new Error(`Unable to start the installed Pe.Tools host: ${result.reason}`);
    }
    return `http://127.0.0.1:${result.file.port}`;
  }

  // Dev lane: one SDK ensureRunning pass scoped to THIS worktree's service name — discover a healthy
  // same-checkout host (matchSourceRoot), evict a stale one, or spawn the source spelling and wait.
  // Never the shared default port, which may belong to another worktree's host.
  // #attach, never #dev: a supervisor-style spawn must not carry --take-over-host (evicting a
  // healthy incumbent livelocks respawn-vs-respawn) nor node --watch (refused spawns must exit,
  // not linger as orphaned watchers). Takeover stays a human spelling (`pnpm dev`).
  // ponytail: it still boots middleware-mode Vite this headless lane never uses; split a web-less
  // entry if the cold-start budget (45s) ever matters here.
  const sourceRoot = checkoutRootFrom(path.dirname(fileURLToPath(import.meta.url)));
  if (!sourceRoot) throw new Error("The dev lane needs a Pe.Tools checkout above pea's sources.");
  const serviceName = sourceHostServiceName(sourceRoot);
  const override = process.env.PE_TOOLS_HOST_LAUNCH_COMMAND?.trim();
  const result = await ensureRunning(productRoot(), serviceName, {
    spawnCommand: {
      command: override ?? "vp",
      args: override ? [] : ["run", "@pe/host#attach"],
      cwd: path.join(sourceRoot, checkoutLayout.ts),
      shell: true,
    },
    matchSourceRoot: sourceRoot,
    health: hostProcessIdentity.healthPath,
    shutdown: hostProcessIdentity.shutdownPath,
    lane: "dev",
    timeoutMs: sourceHostStartupTimeoutMs,
    spawnEnv: {
      [sourceRootVariable]: sourceRoot,
      [hostProcessIdentity.serviceNameVariable]: serviceName,
    },
  });
  if (result.state === "failed")
    throw new Error(
      `Unable to start this worktree's dev host ('${serviceName}'): ${result.reason}`,
    );
  return `http://127.0.0.1:${result.file.port}`;
}

async function resolveInstalledHostLaunch(): Promise<{
  appBase: string;
  entryPath: string;
} | null> {
  // Fixed installed layout under the product root (service-identity.ts pins it): this pea is
  // `<root>\bin\pea\pea.exe` and the host it supervises is `<root>\bin\host\Pe.Host.exe`.
  // Being inside `bin\pea` is what makes this the installed lane; there is no pointer or receipt.
  const appBase = productRoot();
  const peaDirectory = path.join(appBase, "bin", "pea");
  if (path.relative(peaDirectory, path.dirname(process.execPath)) !== "") return null;
  const entryPath = path.join(appBase, "bin", "host", "Pe.Host.exe");
  if (!existsSync(entryPath)) throw new Error(`installed host entry is missing: ${entryPath}`);
  return { appBase, entryPath };
}

async function sendPeaMessageWithTimeout(
  session: PeaPromptSession,
  content: string,
  timeoutSeconds: number,
) {
  const beforeMessages = await session.thread.listActiveMessages({ limit: 80 });
  const beforeIds = new Set(beforeMessages.flatMap((message) => (message.id ? [message.id] : [])));
  const deadline = Date.now() + timeoutSeconds * 1000;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      session.abort();
      reject(new Error(`Pea did not finish within ${timeoutSeconds} seconds.`));
    }, timeoutSeconds * 1000);
  });

  try {
    trace("sendMessage start");
    await Promise.race([session.sendMessage({ content }), timeout]);
    trace("sendMessage resolved; polling for new assistant text");
    const latestText = await waitForNewAssistantText(session, beforeIds, deadline);
    trace(`poll finished hasText=${Boolean(latestText)}`);
    if (!latestText) {
      return {
        ok: false,
        timedOut: Date.now() >= deadline,
        latestAssistantText: "Pea did not produce an assistant response for this turn.",
      };
    }

    return { ok: true, timedOut: false, latestAssistantText: latestText };
  } catch (error) {
    return {
      ok: false,
      timedOut,
      latestAssistantText: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForNewAssistantText(
  session: PeaPromptSession,
  beforeIds: Set<string>,
  deadline: number,
): Promise<string> {
  while (Date.now() < deadline) {
    const messages = await session.thread.listActiveMessages({ limit: 80 });
    const newAssistantText = latestAssistantText(
      messages.filter((message) => !message.id || !beforeIds.has(message.id)),
    );
    if (newAssistantText) return newAssistantText;

    await delay(500);
  }

  return "";
}

function latestAssistantText(messages: readonly PeaPromptMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;

    const text = textFromMessage(message);
    if (text) return text;
  }

  return "";
}

function textFromMessage(message: { content: MastraDBMessage["content"] }): string {
  return message.content.parts
    .map((part) => {
      const typedPart = readRecord(part);
      return typedPart?.type === "text" && typeof typedPart.text === "string" ? typedPart.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
