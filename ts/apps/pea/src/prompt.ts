import { createPeClient } from "@pe/agent-contracts/pe-api";
/**
 * `pea --prompt` - one headless turn on a harness thread (ADR 0015: the harness drives).
 *
 * Creates (or, with `--thread`, continues) a host harness thread, posts the prompt, and follows
 * the thread's SSE event log until that turn ends. Permission requests are answered with
 * `reject_once` unless `--allow`. A question card ends the turn with `stopReason: "question"` and the
 * questions as the response; the next `--thread` prompt carries the answers. Prints `{ ok, host,
 * threadId, harness, model, stopReason, response }`.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HarnessEvent, HarnessId } from "@pe/agent-contracts";
import { hostProcessIdentity, productInstallLayout } from "@pe/host-contracts/contracts";
import {
  checkoutLayout,
  productRoot,
  sourceRootVariable,
} from "@pe/host-contracts/service-identity";
import { ensureRunning, readServiceFile } from "@pe/host-contracts/pe-service";
import { discoverHostBaseUrl, resolveHostBaseUrl, resolveLaneAndRoot } from "@pe/mcps";
import { contextFetch as fetch, invocationContext } from "@pe/mcps/context";

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
  const held = invocationContext();
  if (held?.hostBaseUrl) resolveHostBaseUrl(held.hostBaseUrl);
  const host = await ensureTsHostRunning();
  const client = createPeClient(host, fetch);
  await client.call("providers.list", {});
  const thread = request.threadId
    ? await client.call("thread.get", { params: { id: request.threadId } })
    : await client.call("threads.create", {
        body: { providerId: request.harness ?? "claude", title: "Pea prompt" },
      });
  const params = { id: thread.id };
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
    if (request.modelId)
      await client.call("thread.model", { params, body: { modelId: request.modelId } });
    const { turnId } = await client.call("thread.prompt", {
      params,
      body: { id: randomUUID(), text: request.prompt },
    });
    trace(`turn ${turnId}`);
    // The log is durable and replayable from `after`, so following it after the POST misses nothing.
    for await (const event of streamEvents(
      client.url("thread.stream", { params, query: { after } }),
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
        await client.call("thread.permission", {
          params,
          body: {
            requestId: event.requestId,
            optionId: option.optionId,
          },
        });
      } else if (event.kind === "question_request") {
        // Headless has no one to fill the question card: the turn ends here with the questions as
        // the response, and the caller's next `--prompt --thread` carries the answers.
        if (chunks.length > 0) chunks.push("\n\n");
        chunks.push(renderQuestions(event.message, event.requestedSchema));
        await client.call("thread.cancel", { params }).catch(() => undefined);
        return { ...result, stopReason: "question", response: chunks.join("").trim() };
      } else if (event.kind === "turn_end") {
        // The thread body's modelId is the settled model unless a model_changed already said so.
        const settled = await client.call("thread.get", { params }).catch(() => null);
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
    await client.call("thread.cancel", { params }).catch(() => undefined);
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
  const owner = resolveLaneAndRoot();
  // Resolve an explicit address through the same receipt guard as MCP before any request or spawn.
  const existing = discoverHostBaseUrl();
  if (existing) return existing;

  const appBase = owner.installedRoot ?? productRoot();
  const launch =
    owner.lane === "installed"
      ? { entryPath: path.join(appBase, productInstallLayout["VersionedApp:host"]) }
      : {
          spawnCommand: {
            command: "vp",
            args: [
              "run",
              "@pe/host#attach",
              ...(owner.serviceName.endsWith("-no-revit") ? ["--", "--no-revit"] : []),
            ],
            cwd: path.join(owner.sourceRoot!, checkoutLayout.ts),
            shell: true,
          },
          matchSourceRoot: owner.sourceRoot!,
          timeoutMs: sourceHostStartupTimeoutMs,
          spawnEnv: {
            [sourceRootVariable]: owner.sourceRoot!,
            [hostProcessIdentity.serviceNameVariable]: owner.serviceName,
          },
        };
  if (launch.entryPath && !existsSync(launch.entryPath))
    throw new Error(`installed host entry is missing: ${launch.entryPath}`);
  const result = await ensureRunning(appBase, owner.serviceName, {
    ...launch,
    health: hostProcessIdentity.healthPath,
    shutdown: hostProcessIdentity.shutdownPath,
    lane: owner.lane,
  });
  if (result.state === "failed")
    throw new Error(
      `Unable to start this runtime's host ('${owner.serviceName}'): ${result.reason}`,
    );
  // The SDK acknowledgement alone is not execution authority. Re-read this runtime's actual receipt
  // after startup and require its verified address to agree with the acknowledged incarnation.
  const claimed = await readServiceFile(appBase, owner.serviceName);
  const verified = resolveHostBaseUrl();
  if (
    !claimed?.instanceId ||
    claimed.instanceId !== result.file.instanceId ||
    claimed.pid !== result.file.pid ||
    claimed.processStartUtc !== result.file.processStartUtc ||
    verified !== `http://127.0.0.1:${result.file.port}`
  )
    throw new Error("Started host acknowledgement disagrees with this runtime's verified service.");
  return verified;
}
