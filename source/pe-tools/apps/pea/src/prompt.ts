/**
 * `pea --prompt` — one headless Pea turn per invocation.
 *
 * Builds a fresh headless Pea runtime (the same product tools, skills, storage, and memory
 * profile as the interactive TUI), sends a single prompt, prints `{ threadId, response }`,
 * and exits. `--thread <id>` continues an existing Pea thread; `--json` prints the result as
 * JSON on stdout. Relocated from the old peco `talk_to_pea` worker; the MCP toolset stays
 * agent-free and harnesses talk to Pea through this CLI mode instead.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@mastra/core/agent";
import type {
  AgentControllerMessage,
  AgentControllerRequestContext,
} from "@mastra/core/agent-controller";
import { defaultGateways, type MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import {
  createMastraCodeAuthStorage,
  createPeaProductStateStorageProfile,
  createRuntimeController,
  createRuntimeMemoryProfile,
  loadStoredMastraCodeApiKeysIntoEnv,
  resolveRuntimeModel,
} from "@pe/runtime";
import {
  HostRpcCaller,
  configurePeaProductToolContext,
  defaultPeaAgentModelId,
  materializeBundledPeaSkills,
  peaProductToolProfile,
  peaProductTools,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolveWorkspaceKey,
} from "@pe/mcps";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { productRoot } from "@pe/host-contracts/service-identity";
import { sourceHostServiceName } from "@pe/host-contracts/service-identity";
import { ensureRunning } from "@pe/host-contracts/pe-service";

const peaConfigDir = ".pea";
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

type PeaPromptRuntime = {
  session: PeaPromptSession;
  close?: () => Promise<void> | void;
};

type PeaPromptMessage = Pick<AgentControllerMessage, "id" | "role" | "content">;

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
  const hostBaseUrl = await ensureTsHostRunning();
  const workspaceKey = resolveWorkspaceKey();
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });

  const cwd = request.workspaceRoot
    ? path.resolve(request.workspaceRoot)
    : await resolvePeaPromptCwd(hostBaseUrl, workspaceKey);
  // Bootstrap (or the explicit headless workspace root) resolves the real product home. Skills
  // must live under the contained workspace filesystem's basePath (= cwd) or discovery silently
  // rejects the skills root and the skill list comes up empty.
  const productHomePath = resolvePeaProductHomePath({ productHomePath: cwd });
  process.chdir(cwd);

  await materializeBundledPeaSkills({ productHomePath });

  const authStorage = await createMastraCodeAuthStorage();
  loadStoredMastraCodeApiKeysIntoEnv(authStorage);
  const agent = new Agent({
    id: "pea-agent",
    name: "Pea Revit Agent",
    description: "High-trust Revit/operator agent for Positive Energy tooling.",
    instructions: peaPromptInstructions,
    model: ({ requestContext }) => resolveCurrentModel(requestContext, defaultPeaAgentModelId),
    tools: peaProductTools,
  });
  const workspace = new Workspace({
    id: "pea-workspace",
    name: "Pea Workspace",
    filesystem: new LocalFilesystem({ basePath: cwd, contained: true }),
    sandbox: new LocalSandbox({ workingDirectory: cwd, env: process.env }),
    skills: resolvePeaSkillPaths({ productHomePath }),
  });
  const handle = await createRuntimeController({
    request: { protocol: "test", cwd, workspaceRoot: cwd },
    config: {
      id: "pea",
      resourceId: createLocalResourceId(cwd),
      workspace,
      modes: [
        {
          id: "agent",
          name: "Agent",
          default: true,
          defaultModelId: defaultPeaAgentModelId,
          agent,
        },
      ],
      gateways: defaultGateways,
      tools: peaProductTools,
      initialState: {
        currentModelId: defaultPeaAgentModelId,
        productHomePath,
        configDir: peaConfigDir,
        // Match the interactive pea runtime (apps/pea/src/runtime.ts): without yolo the
        // agent-controller runs with requireToolApproval=true and every tool call parks on
        // an interactive approval gate that this headless mode can never answer.
        yolo: true,
        thinkingLevel: "high",
      },
    },
    storageProfile: createPeaProductStateStorageProfile(),
    memoryProfile: createRuntimeMemoryProfile({ id: "pea-memory" }),
    toolProfile: peaProductToolProfile,
    workspace: { cwd, root: cwd },
    authStorage,
    metadata: {
      runtimeId: "pea",
      hostBaseUrl,
      workspaceKey,
      protocol: "pea_prompt",
    },
  });

  if (!handle.session) throw new Error("Expected Pea prompt runtime session.");
  return { session: handle.session, close: handle.close };
}

const peaPromptInstructions = `You are Positive Energy Agent, Pea: the deployed Revit/operator workbench for MEP, BIM, and architecture practitioners.
Use Pea product tools to inspect host/Revit state, run approved scripts, and produce operator-facing answers. Stay inside the deployed product posture: do not inspect repo source or present build/Rider/RRD internals as user-facing facts. Prefer small observable steps, say what you verified, and be explicit when live Revit evidence is unavailable.`;

async function resolvePeaPromptCwd(hostBaseUrl: string, workspaceKey: string): Promise<string> {
  // Bootstrap always targets the user's session: with sandboxes connected an untargeted
  // call hard-fails on ambiguity, and pea's product home lives with the user session.
  const client = new HostRpcCaller({ hostBaseUrl: hostBaseUrl, bridgeSessionId: "user" });
  try {
    const bootstrap = await client.call("scripting.workspace.bootstrap", {
      workspaceKey,
    });
    if (!bootstrap.productHomePath) throw new Error("bootstrap returned no productHomePath");
    return path.resolve(bootstrap.productHomePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to resolve Pe.Tools product home through the TS host at ${hostBaseUrl}: ${detail}`,
    );
  }
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
      expectedVersion: installed.version,
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
  // ponytail: #dev boots middleware-mode Vite that this headless lane never uses; split a web-less
  // #start entry if the cold-start budget (45s) ever matters here.
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const serviceName = sourceHostServiceName(sourceRoot);
  const override = process.env.PE_TOOLS_HOST_LAUNCH_COMMAND?.trim();
  const result = await ensureRunning(productRoot(), serviceName, {
    spawnCommand: {
      command: override ?? "vp",
      args: override ? [] : ["run", "@pe/host#dev"],
      cwd: sourceRoot,
      shell: true,
    },
    matchSourceRoot: sourceRoot,
    health: hostProcessIdentity.healthPath,
    shutdown: hostProcessIdentity.shutdownPath,
    lane: "dev",
    timeoutMs: sourceHostStartupTimeoutMs,
    spawnEnv: {
      PE_TOOLS_HOST_SOURCE_DIR: sourceRoot,
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
  version: string;
} | null> {
  // Installed SEA layout: <appBase>/bin/pea/versions/<version>/pea.exe. Walking to the copied
  // manifest keeps this independent of CWD and uses the same product root the SDK installer wrote.
  for (let directory = path.dirname(process.execPath); ; directory = path.dirname(directory)) {
    const manifest = path.join(directory, "product.payloads.json");
    if (existsSync(manifest)) {
      try {
        const receipt = JSON.parse(
          await readFile(path.join(directory, "install.receipt.json"), "utf8"),
        ) as { releaseVersion?: unknown };
        const version = (
          await readFile(path.join(directory, "bin", "host", "current.txt"), "utf8")
        ).trim();
        if (typeof receipt.releaseVersion !== "string" || receipt.releaseVersion !== version) {
          throw new Error("installed host pointer does not match the install receipt");
        }
        const entryPath = path.join(directory, "bin", "host", "versions", version, "Pe.Host.exe");
        if (!existsSync(entryPath))
          throw new Error(`installed host entry is missing: ${entryPath}`);
        return { appBase: directory, entryPath, version };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Installed Pe.Tools host resolution failed at ${directory}: ${detail}`);
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
  }
}

function resolveCurrentModel(
  requestContext: RequestContext,
  fallbackModelId: string,
): Promise<MastraModelConfig> {
  const controller = requestContext.get("controller") as
    | AgentControllerRequestContext<{ currentModelId?: string }>
    | undefined;
  const modelId =
    controller?.session.modelId || controller?.getState().currentModelId || fallbackModelId;
  return resolveRuntimeModel(modelId, requestContext);
}

function createLocalResourceId(cwd: string): string {
  const digest = createHash("sha256")
    .update(`${hostname()}\n${path.resolve(cwd)}`)
    .digest("hex")
    .slice(0, 16);
  return `pea:${digest}`;
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

function textFromMessage(message: { content: readonly unknown[] }): string {
  return message.content
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
