import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import type {
  InferenceEndpoint,
  InferenceEndpointSaveRequest,
} from "@pe/host-contracts/operation-types";
import { productInferenceEndpointPath } from "./product-paths.ts";

type Saved = {
  baseUrl: string;
  apiKey: string;
  probe: { model: string; atUtc: string };
};

type Step = "url" | "models" | "chat" | "write";

/** A refusal names the step that failed; the route serves it as `{ step, message }`. */
class InferenceEndpointError {
  readonly _tag = "InferenceEndpointError";
  readonly message: string;
  constructor(
    readonly step: Step,
    note: string,
    readonly status = 400,
  ) {
    this.message = `${step} step failed: ${note}`;
  }
}
const fail = (step: Step, note: string, status?: number) =>
  new InferenceEndpointError(step, note, status);
const excerpt = (body: string) => body.trim().slice(0, 300);

/** The saved endpoint, or null. */
export function readSaved(): Saved | null {
  const path = productInferenceEndpointPath();
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Saved) : null;
}

/** The provider id the codex child is told to use; its key rides in `PEA_ENDPOINT_API_KEY`. */
const CODEX_PROVIDER = "pea_endpoint";

/**
 * The saved endpoint as harness child env (ADR 0015). Only Codex takes it: the saved endpoint is
 * OpenAI-compatible, and FALSIFIED 2026-10-01 handing it to Claude as ANTHROPIC_BASE_URL fails every
 * Claude turn with "unknown provider for model claude-*" when the endpoint serves no Claude models.
 *
 * Codex ignores OPENAI_BASE_URL while a ChatGPT login exists (FALSIFIED 2026-10-01: no proxy
 * request), so the endpoint goes in as a custom model provider the way T3 Code does it:
 * codex-acp merges `CODEX_CONFIG` into every session config and `MODEL_PROVIDER` selects it.
 */
export function harnessEndpointEnv(harness: "claude" | "codex"): Record<string, string> {
  const saved = readSaved();
  if (!saved || harness !== "codex") return {};
  return {
    MODEL_PROVIDER: CODEX_PROVIDER,
    CODEX_CONFIG: JSON.stringify({
      model_provider: CODEX_PROVIDER,
      model_providers: {
        [CODEX_PROVIDER]: {
          name: "Pea inference endpoint",
          base_url: saved.baseUrl,
          env_key: "PEA_ENDPOINT_API_KEY",
          wire_api: "responses",
          requires_openai_auth: false,
          supports_websockets: false,
        },
      },
    }),
    PEA_ENDPOINT_API_KEY: saved.apiKey,
  };
}

const view = (saved: Saved | null): InferenceEndpoint => ({
  baseUrl: saved?.baseUrl ?? null,
  apiKeyRedacted: saved ? `…${saved.apiKey.slice(-4)}` : null,
  probe: saved?.probe ?? null,
});

export const readInferenceEndpoint = () => Effect.sync(() => view(readSaved()));

/** http(s) only; an empty path becomes `/v1`, a path must otherwise already end in `/v1`. */
function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw fail("url", `"${raw}" is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw fail("url", `scheme must be http or https, got ${url.protocol}`);
  if (url.search || url.hash) throw fail("url", "base URL must not carry a query or fragment");
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "" && !path.endsWith("/v1"))
    throw fail("url", `path must be empty or end in /v1, got ${path}`);
  return `${url.origin}${path || "/v1"}`;
}

async function upstream(step: "models" | "chat", url: string, apiKey: string, body?: unknown) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  }).catch((e: unknown) => {
    throw fail(step, `${url} unreachable: ${String(e)}`, 502);
  });
  const text = await response.text();
  if (response.status !== 200)
    throw fail(step, `HTTP ${response.status} from ${url}: ${excerpt(text)}`, 502);
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw fail(step, `HTTP 200 from ${url} was not JSON: ${excerpt(text)}`, 502);
  }
}

/** Prove, then persist: models lists at least one model, and the first answers one Responses call. */
export const saveInferenceEndpoint = (request: InferenceEndpointSaveRequest) =>
  Effect.tryPromise({
    try: async () => {
      const baseUrl = normalizeBaseUrl(request.baseUrl);
      const apiKey = request.apiKey.trim();
      if (!apiKey || /\s/.test(apiKey))
        throw fail("url", "API key is empty or contains whitespace");
      const models = await upstream("models", `${baseUrl}/models`, apiKey);
      const model: unknown = Array.isArray(models.data) ? models.data[0]?.id : undefined;
      if (typeof model !== "string" || !model)
        throw fail(
          "models",
          `HTTP 200 but data[] lists no model: ${excerpt(JSON.stringify(models))}`,
          502,
        );
      // A Codex child speaks the Responses API to this endpoint, so the probe proves /responses.
      const chat = await upstream("chat", `${baseUrl}/responses`, apiKey, {
        model,
        input: "Reply with the single word OK.",
        max_output_tokens: 64,
      });
      const content = chat.output
        ?.find((o: { type?: string }) => o?.type === "message")
        ?.content?.find((c: { type?: string }) => c?.type === "output_text")?.text;
      if (typeof content !== "string" || !content.trim())
        throw fail(
          "chat",
          `HTTP 200 but no assistant message: ${excerpt(JSON.stringify(chat))}`,
          502,
        );
      const saved: Saved = { baseUrl, apiKey, probe: { model, atUtc: new Date().toISOString() } };
      const path = productInferenceEndpointPath();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(saved, null, 2), "utf8");
      return view(saved);
    },
    catch: (e) => (e instanceof InferenceEndpointError ? e : fail("write", String(e), 500)),
  });
