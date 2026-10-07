/**
 * `pea --prompt` - one headless turn on a harness thread (ADR 0015: the harness drives).
 *
 * Creates (or, with `--thread`, continues) a host harness thread, posts the prompt, and follows
 * the thread's SSE event log until that turn ends. Permission requests are answered with
 * `reject_once` unless `--allow`. A question card ends the turn with `stopReason: "question"` and the
 * questions as the response; the next `--thread` prompt carries the answers. Prints `{ ok, host,
 * threadId, harness, model, stopReason, response }`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  HarnessEvent,
  HarnessId,
  HarnessThreadBody,
  HarnessThreadSummary,
} from "@pe/agent-contracts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { productRoot } from "@pe/host-contracts/service-identity";
import {
  checkoutLayout,
  checkoutRootFrom,
  sourceHostServiceName,
  sourceRootVariable,
} from "@pe/host-contracts/service-identity";
import { ensureRunning } from "@pe/host-contracts/pe-service";

const sourceHostStartupTimeoutMs = 45_000;

// Progress breadcrumbs on stderr: off by default so `pea --prompt --json` stays pipe-clean.
// Set PEA_PROMPT_TRACE=1 to locate a stuck await on timeout.
function trace(message: string): void {
  if (process.env.PEA_PROMPT_TRACE !== "1") return;
  process.stderr.write(`[pea-prompt ${new Date().toISOString()}] ${message}\n`);
}

export interface PeaPromptRequest {
  prompt: string;
  harness?: HarnessId;
  threadId?: string;
  /** Posted to the thread's `/model` before the prompt. */
  modelId?: string;
  json?: boolean;
  timeoutSeconds?: number;
  /** Answer permission requests with `allow_once`; otherwise `reject_once`. */
  allow?: boolean;
}

export interface PeaPromptResult {
  ok: boolean;
  /** Host base URL the run talked to. */
  host: string;
  threadId: string;
  harness: HarnessId | "";
  model: string | null;
  stopReason: string;
  response: string;
  /** Tool calls whose permission request this run rejected (pass --allow to approve them). */
  rejected: string[];
}

/** Run one headless prompt, print the result, and return the process exit code. */
export async function runPeaPrompt(request: PeaPromptRequest): Promise<number> {
  let result: PeaPromptResult;
  try {
    result = await runPeaPromptTurn(request);
  } catch (error) {
    result = {
      ok: false,
      host: "",
      threadId: request.threadId ?? "",
      harness: "",
      model: request.modelId ?? null,
      stopReason: "error",
      response: error instanceof Error ? error.message : String(error),
      rejected: [],
    };
  }

  if (request.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${result.response}\n`);
    if (result.rejected.length > 0)
      process.stdout.write(`rejected: ${result.rejected.join(", ")} (pass --allow)\n`);
    process.stdout.write(`threadId: ${result.threadId || "(none)"}\n`);
  }
  return result.ok ? 0 : 1;
}

export async function runPeaPromptTurn(request: PeaPromptRequest): Promise<PeaPromptResult> {
  const host = await ensureTsHostRunning();
  const base = `${host}/pe/threads`;
  // An older host without the harness wire answers 404 on thread routes; name it up front.
  const harnesses = await fetch(`${host}/pe/harnesses`);
  if (!harnesses.ok)
    throw new Error(
      `Host ${host} predates the harness wire (GET /pe/harnesses -> ${harnesses.status}); restart it.`,
    );
  await harnesses.arrayBuffer();
  const call = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} /pe/threads${route} -> ${response.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };

  const thread: HarnessThreadSummary & Partial<Pick<HarnessThreadBody, "events">> = request.threadId
    ? await call<HarnessThreadBody>("GET", `/${request.threadId}`)
    : await call<HarnessThreadSummary>("POST", "", {
        harness: request.harness ?? "claude",
        title: "Pea prompt",
      });
  const after = thread.lastSeq;
  trace(`thread ${thread.id} harness=${thread.harness} after=${after}`);

  const result: PeaPromptResult = {
    ok: false,
    host,
    threadId: thread.id,
    harness: thread.harness,
    model: request.modelId ?? thread.modelId,
    stopReason: "",
    response: "",
    rejected: [],
  };
  const timeoutSeconds = request.timeoutSeconds ?? 900;
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  // Closing the SSE body on exit is what lets the process end without a libuv teardown assertion.
  const streamAbort = new AbortController();
  const chunks: string[] = [];
  let breakBeforeNextChunk = false;
  let modelSeen = false;
  try {
    if (request.modelId) await call("POST", `/${thread.id}/model`, { modelId: request.modelId });
    const { turnId } = await call<{ turnId: string }>("POST", `/${thread.id}/prompt`, {
      text: request.prompt,
    });
    trace(`turn ${turnId}`);
    // The log is durable and replayable from `after`, so following it after the POST misses nothing.
    for await (const event of streamEvents(
      `${base}/${thread.id}/stream?after=${after}`,
      AbortSignal.any([signal, streamAbort.signal]),
    )) {
      trace(`event ${event.kind}`);
      if (event.kind === "model_changed") {
        result.model = event.modelId;
        modelSeen = true;
      }
      if (event.kind === "error" && event.turnId === null)
        return { ...result, stopReason: "error", response: event.message };
      if (!("turnId" in event) || event.turnId === null) {
        if (event.kind !== "permission_request") continue;
      } else if (event.turnId !== turnId) continue;
      if (event.kind === "update") {
        if (event.turnId === null) continue;
        if (event.update.sessionUpdate !== "agent_message_chunk") breakBeforeNextChunk = true;
        else {
          const content = event.update.content as { type?: string; text?: string } | undefined;
          if (content?.type === "text" && content.text) {
            if (breakBeforeNextChunk && chunks.length > 0) chunks.push("\n");
            breakBeforeNextChunk = false;
            chunks.push(content.text);
          }
        }
      } else if (event.kind === "permission_request") {
        const want = request.allow ? "allow" : "reject";
        // `allow_always` would outlive this one headless turn; take it only when nothing else allows.
        const option =
          event.options.find((candidate) => candidate.kind === `${want}_once`) ??
          event.options.find((candidate) => candidate.kind.startsWith(want));
        if (!option) throw new Error(`Permission ${event.requestId} offers no ${want} option.`);
        if (!request.allow) result.rejected.push(event.toolCall?.title ?? event.requestId);
        await call("POST", `/${thread.id}/permission`, {
          requestId: event.requestId,
          optionId: option.optionId,
        });
      } else if (event.kind === "question_request") {
        // Headless has no one to fill the question card: the turn ends here with the questions as
        // the response, and the caller's next `--prompt --thread` carries the answers.
        if (chunks.length > 0) chunks.push("\n\n");
        chunks.push(renderQuestions(event.message, event.requestedSchema));
        await call("POST", `/${thread.id}/cancel`).catch(() => undefined);
        return { ...result, stopReason: "question", response: chunks.join("").trim() };
      } else if (event.kind === "turn_end") {
        // The thread body's modelId is the settled model unless a model_changed already said so.
        const settled = await call<HarnessThreadBody>("GET", `/${thread.id}`).catch(() => null);
        return {
          ...result,
          model: modelSeen ? result.model : (settled?.modelId ?? result.model),
          ok: event.stopReason === "end_turn",
          stopReason: event.stopReason,
          response: chunks.join("").trim(),
        };
      } else if (event.kind === "error") {
        return { ...result, stopReason: "error", response: event.message };
      }
    }
    throw new Error("The thread stream closed before the turn ended.");
  } catch (error) {
    if (!signal.aborted) {
      const response = error instanceof Error ? error.message : String(error);
      return { ...result, stopReason: "error", response };
    }
    await call("POST", `/${thread.id}/cancel`).catch(() => undefined);
    const response = `Pea did not finish within ${timeoutSeconds} seconds.`;
    return { ...result, stopReason: "timeout", response };
  } finally {
    streamAbort.abort();
  }
}

/** The ACP form schema as text: one numbered question per property, its options after it. */
function renderQuestions(message: string, schema: Record<string, unknown>): string {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const lines = [message];
  Object.values(properties).forEach((property, index) => {
    const title = typeof property.title === "string" ? `${property.title}: ` : "";
    lines.push(`${index + 1}. ${title}${String(property.description ?? "")}`.trim());
    for (const option of (property.oneOf ?? []) as Record<string, unknown>[]) {
      const label = String(option.title ?? option.const ?? "");
      lines.push(`   - ${label}${option.description ? `: ${String(option.description)}` : ""}`);
    }
  });
  return lines.join("\n");
}

async function* streamEvents(url: string, signal: AbortSignal): AsyncGenerator<HarnessEvent> {
  const response = await fetch(url, { signal, headers: { accept: "text/event-stream" } });
  if (!response.ok || !response.body) throw new Error(`GET ${url} -> ${response.status}`);
  let buffer = "";
  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const data = buffer
        .slice(0, end)
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      buffer = buffer.slice(end + 2);
      if (data) yield JSON.parse(data) as HarnessEvent;
    }
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
