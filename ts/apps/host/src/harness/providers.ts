import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { PROTOCOL_VERSION, type SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  accessSchema,
  addProviderRequestSchema,
  harnessIds,
  type Access,
  type AddProviderRequest,
  type HarnessId,
  type HarnessModel,
  type Provider,
  type Readiness,
  type TraitOption,
} from "@pe/agent-contracts";
import { Effect } from "effect";
import { z } from "zod";
import { productAccessPath, productProvidersPath } from "../product-paths.ts";
import { adapterCli, adapterLogin, adapters, openAdapter, stopChild } from "./adapter.ts";
import { mergePath } from "./user-shell.ts";

/**
 * Providers: one harness with one auth source. A subscription provider (the harness's own login)
 * exists for every harness with id = harness id; endpoint providers are user-added and live in
 * `providers.json` under product state with their key, which never leaves this module except as
 * child env. Readiness, models and traits come from one probe per provider, cached per host start.
 */

type ProviderRecord = {
  id: string;
  harness: HarnessId;
  name: string;
  auth: { kind: "subscription" } | AddProviderRequest["auth"];
};
type EndpointRecord = ProviderRecord & { auth: AddProviderRequest["auth"] };
type Probed = Pick<Provider, "readiness" | "models" | "traits" | "probedAt">;

const PROBE_MS = 20_000;
const log = {
  info: (message: string) => Effect.runSync(Effect.logInfo(message)),
  warn: (message: string) => Effect.runSync(Effect.logWarning(message)),
};

/* ── What a session offers: models and traits, shared by the probe and every thread ── */

const flatten = (option: SessionConfigOption & { type: "select" }) =>
  option.options.flatMap((o) => ("options" in o ? o.options : [o]));

/** Mode and collaboration mode are not traits: access sets the mode, plan mode is not offered. */
const notTraits = new Set(["model", "mode", "collaboration_mode"]);

export function traitsOf(configOptions: readonly SessionConfigOption[]): TraitOption[] {
  return configOptions
    .filter((o) => !notTraits.has(o.category ?? "") && o.id !== "mode")
    .map((o) =>
      o.type === "boolean"
        ? { id: o.id, name: o.name, kind: "boolean" as const, current: o.currentValue }
        : {
            id: o.id,
            name: o.name,
            kind: "select" as const,
            options: flatten(o).map(({ value, name }) => ({ id: value, name })),
            current: o.currentValue ?? null,
          },
    );
}

/**
 * Models from the `model` config option when the harness offers one: codex-acp lists base ids there
 * (`gpt-6.1-sol`) and effort as its own option, where the unstable `models` state multiplies them
 * (`gpt-6.1-sol[low]`). The unstable state is the fallback for an adapter with no config option.
 */
export function sessionOffer(session: {
  configOptions?: SessionConfigOption[] | null;
  models?: { availableModels: { modelId: string; name: string }[]; currentModelId: string } | null;
}): { models: HarnessModel[]; modelId: string | null; traits: TraitOption[] } {
  const configOptions = session.configOptions ?? [];
  const option = configOptions.find((o) => o.category === "model");
  if (option?.type === "select")
    return {
      models: flatten(option).map((o) => ({ modelId: o.value, name: o.name })),
      modelId: option.currentValue,
      traits: traitsOf(configOptions),
    };
  return {
    models: session.models?.availableModels.map(({ modelId, name }) => ({ modelId, name })) ?? [],
    modelId: session.models?.currentModelId ?? null,
    traits: traitsOf(configOptions),
  };
}

/** The ACP mode a session starts in: the first of these the harness offers. */
export const accessModes = {
  guarded: ["auto", "agent", "default"],
  unguarded: ["bypassPermissions", "agent-full-access", "full-access"],
};

/* ── Child env per provider ── */

const CODEX_PROVIDER = "pea_endpoint";

/**
 * The auth part of a child's env. Codex ignores OPENAI_BASE_URL under a ChatGPT login (FALSIFIED
 * 2026-10-01), so an endpoint goes in as a custom model provider the way T3 Code does it: codex-acp
 * merges `CODEX_CONFIG` into every session config and `MODEL_PROVIDER` selects it. Claude takes
 * `ANTHROPIC_BASE_URL` plus `ANTHROPIC_AUTH_TOKEN` (PROVEN through claude-agent-acp 0.84.0 against
 * a local stub, 2026-10-08, agent LEDGER Owed).
 */
function authEnv(record: ProviderRecord, modelId?: string): Record<string, string> {
  const auth = record.auth;
  if (auth.kind === "subscription") return {};
  if (record.harness === "claude")
    return {
      ANTHROPIC_BASE_URL: auth.baseUrl,
      ANTHROPIC_AUTH_TOKEN: auth.apiKey,
      ...(modelId ? { ANTHROPIC_MODEL: modelId, ANTHROPIC_CUSTOM_MODEL_OPTION: modelId } : {}),
    };
  return {
    MODEL_PROVIDER: CODEX_PROVIDER,
    CODEX_CONFIG: JSON.stringify({
      ...(modelId ? { model: modelId } : {}),
      model_provider: CODEX_PROVIDER,
      model_providers: {
        [CODEX_PROVIDER]: {
          name: `Pea endpoint ${record.name}`,
          base_url: auth.baseUrl,
          env_key: "PEA_ENDPOINT_API_KEY",
          wire_api: "responses",
          requires_openai_auth: false,
          supports_websockets: false,
        },
      },
    }),
    PEA_ENDPOINT_API_KEY: auth.apiKey,
  };
}

/* ── The endpoint check: the URL answers models and one tiny request ── */

class Refusal extends Error {
  readonly step = "endpoint";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
const excerpt = (body: string) => body.trim().slice(0, 300);

/**
 * http(s) only. Codex's base ends in `/v1` (an empty path becomes `/v1`); Claude's is the origin the
 * Anthropic client appends `/v1/messages` to, so a trailing `/v1` is dropped.
 */
function normalizeBaseUrl(harness: HarnessId, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Refusal(`"${raw}" is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Refusal(`scheme must be http or https, got ${url.protocol}`);
  if (url.search || url.hash) throw new Refusal("base URL must not carry a query or fragment");
  const path = url.pathname.replace(/\/+$/, "");
  if (harness === "claude") return `${url.origin}${path.replace(/\/v1$/, "")}`;
  if (path !== "" && !path.endsWith("/v1"))
    throw new Refusal(`path must be empty or end in /v1, got ${path}`);
  return `${url.origin}${path || "/v1"}`;
}

async function upstream(
  step: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Record<string, any>> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(PROBE_MS),
  }).catch((e: unknown) => {
    throw new Refusal(`${step}: ${url} unreachable: ${String(e)}`);
  });
  const text = await response.text();
  if (response.status !== 200)
    throw new Refusal(
      `${step}: HTTP ${response.status} from ${url}: ${excerpt(text)}`,
      response.status,
    );
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Refusal(`${step}: HTTP 200 from ${url} was not JSON: ${excerpt(text)}`);
  }
}

/** Codex speaks the Responses API to the endpoint, Claude the Messages API: each probe proves its own. */
async function checkEndpoint(
  harness: HarnessId,
  baseUrl: string,
  apiKey: string,
  selectedModel?: string,
  codexModels?: readonly HarnessModel[],
) {
  const claude = harness === "claude";
  const headers: Record<string, string> = claude
    ? { authorization: `Bearer ${apiKey}`, "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${apiKey}` };
  const root = claude ? `${baseUrl}/v1` : baseUrl;
  const listed = await upstream("models", `${root}/models`, headers);
  const models: HarnessModel[] = Array.isArray(listed.data)
    ? [
        ...new Set<string>(
          listed.data.flatMap((row: { id?: unknown }) =>
            typeof row?.id === "string" && row.id.trim() ? [row.id] : [],
          ),
        ),
      ]
        .filter((id) =>
          claude
            ? /^claude-/i.test(id) || id === selectedModel
            : codexModels?.some((model) => model.modelId === id),
        )
        .map((modelId) => ({ modelId, name: modelId }))
    : [];
  // A custom Responses model without Codex metadata can reject the reasoning/tool
  // fields the harness sends even when the tiny endpoint request succeeds.
  if (!claude && selectedModel && !codexModels?.some((model) => model.modelId === selectedModel))
    throw new Refusal(
      `Codex metadata does not list ${selectedModel}; harness compatibility is unverified. Choose a model listed by both Codex and the endpoint: ${models.map((m) => m.modelId).join(", ") || "none"}`,
    );
  if (!models.length)
    throw new Refusal(
      `models: the endpoint lists no ${claude ? "Claude Messages" : "model with Codex metadata"} model`,
    );
  const prompt = "Reply with the single word OK.";
  // Catalog order is not availability. Prefer the harness default, then try at most three
  // advertised candidates, only continuing past model-specific 400/404 refusals.
  if (selectedModel && !models.some((model) => model.modelId === selectedModel))
    throw new Refusal(
      `Model ${selectedModel} is not listed for this harness. Listed models: ${models.map((m) => m.modelId).join(", ")}`,
    );
  const candidates = selectedModel
    ? models.filter((model) => model.modelId === selectedModel)
    : [...models]
        .sort((a, b) => {
          const rank = (id: string) =>
            claude ? (/haiku/.test(id) ? 0 : 1) : id === codexModels?.[0]?.modelId ? 0 : 1;
          return rank(a.modelId) - rank(b.modelId) || a.modelId.localeCompare(b.modelId);
        })
        .slice(0, 3);
  const failures: string[] = [];
  const rejected = new Set<string>();
  for (const { modelId: model } of candidates) {
    try {
      const reply = claude
        ? await upstream("messages", `${root}/messages`, headers, {
            model,
            max_tokens: 16,
            messages: [{ role: "user", content: prompt }],
          })
        : await upstream("responses", `${root}/responses`, headers, {
            model,
            input: prompt,
            max_output_tokens: 64,
          });
      const text: unknown = claude
        ? reply.content?.find((c: { type?: string }) => c?.type === "text")?.text
        : reply.output
            ?.find((o: { type?: string }) => o?.type === "message")
            ?.content?.find((c: { type?: string }) => c?.type === "output_text")?.text;
      if (typeof text !== "string" || !text.trim())
        throw new Refusal(
          `${claude ? "messages" : "responses"}: HTTP 200 but no assistant text: ${excerpt(JSON.stringify(reply))}`,
        );
      return [
        models.find((m) => m.modelId === model)!,
        ...models.filter((m) => m.modelId !== model && !rejected.has(m.modelId)),
      ];
    } catch (error) {
      if (!(error instanceof Refusal) || (error.status !== 400 && error.status !== 404))
        throw error;
      failures.push(`${model}: ${error.message}`);
      rejected.add(model);
    }
  }
  throw new Refusal(
    `No tested model answered (${candidates.length} candidates): ${failures.join("; ")}. Set Model to another listed model: ${models.map((m) => m.modelId).join(", ")}`,
  );
}

/* ── The ACP probe: initialize, one session with no MCP servers, read, kill ── */

type AuthStatus = { kind?: string; label?: string };

/** Installed login uses the shipped CLI; source login uses the user's PATH. */
function cliOnPath(harness: HarnessId, env: Record<string, string | undefined>): boolean {
  const cli = adapterCli(harness);
  if (isAbsolute(cli)) return existsSync(cli);
  const finder = process.platform === "win32" ? "where.exe" : "which";
  return (
    spawnSync(finder, [adapters[harness].cli], { env, windowsHide: true, timeout: 5000 }).status ===
    0
  );
}

async function acpProbe(
  record: ProviderRecord,
  env: Record<string, string | undefined>,
): Promise<Omit<Probed, "probedAt">> {
  const none = { models: [], traits: [] };
  let authStatus: AuthStatus | null = null;
  let opened: ReturnType<typeof openAdapter>;
  try {
    opened = openAdapter(record.harness, tmpdir(), env, () => ({
      sessionUpdate: async () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      // `_auth/status_update` from both adapters (seen 2026-10-08): kind `account` or `none`.
      extNotification: async (method, params) => {
        if (method.endsWith("auth/status_update"))
          authStatus = (params as { authStatus?: AuthStatus }).authStatus ?? null;
      },
    }));
  } catch (error) {
    return {
      readiness: {
        state: "refused",
        step: "installed",
        message: `The ${adapters[record.harness].title} adapter is missing: ${String(error)}`,
      },
      ...none,
    };
  }
  const { child, conn, stderr } = opened;
  const signedOut = (detail: string): Readiness =>
    record.auth.kind === "endpoint"
      ? {
          state: "refused",
          step: "endpoint",
          message: `The harness refused the endpoint: ${detail}`,
        }
      : cliOnPath(record.harness, env)
        ? {
            state: "refused",
            step: "signed-in",
            message: `${adapters[record.harness].title} is not signed in (${detail}).`,
          }
        : {
            state: "refused",
            step: "installed",
            message: `${adapters[record.harness].title} is not signed in and \`${adapters[record.harness].cli}\` is not on your PATH.`,
          };
  const work = (async (): Promise<Omit<Probed, "probedAt">> => {
    await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    const session = await conn.newSession({ cwd: tmpdir(), mcpServers: [] }).catch((error) => {
      const message = String(error?.message ?? error);
      if (/auth/i.test(message)) return { refused: message };
      throw error;
    });
    if ("refused" in session) return { readiness: signedOut(session.refused), ...none };
    const state = session as Parameters<typeof sessionOffer>[0];
    const offer = sessionOffer(state);
    const status = authStatus as AuthStatus | null;
    // An endpoint provider is not a login: Claude reports "Not logged in" under ANTHROPIC_* env.
    if (record.auth.kind === "subscription" && status?.kind === "none")
      return {
        readiness: signedOut(status.label ?? "not logged in"),
        models: offer.models,
        traits: offer.traits,
      };
    if (record.auth.kind === "subscription" || record.harness === "claude")
      return { readiness: { state: "ready" }, models: offer.models, traits: offer.traits };
    // Endpoint Codex: native models only, current first. The config picker also synthesizes a row
    // for an unknown current model; the unstable model state is native metadata, as model[effort].
    const base = (modelId: string) => modelId.replace(/\[[^\]]+\]$/, "");
    const current = offer.modelId && base(offer.modelId);
    const models = [...new Set(state.models?.availableModels.map((m) => base(m.modelId)))]
      .map(
        (modelId) => offer.models.find((m) => m.modelId === modelId) ?? { modelId, name: modelId },
      )
      .sort((x, y) => Number(y.modelId === current) - Number(x.modelId === current));
    return { readiness: { state: "ready" }, models, traits: offer.traits };
  })();
  const timeout = new Promise<Omit<Probed, "probedAt">>((resolve) =>
    setTimeout(resolve, PROBE_MS, {
      readiness: { state: "unknown", message: `The probe timed out after ${PROBE_MS / 1000} s.` },
      ...none,
    }).unref(),
  );
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    return {
      readiness: {
        state: "unknown",
        message:
          `The probe failed: ${String((error as Error)?.message ?? error)} ${stderr().trim().slice(-300)}`.trim(),
      },
      ...none,
    };
  } finally {
    void stopChild(child);
  }
}

/* ── The store and the routes ── */

const storedSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      harness: addProviderRequestSchema.shape.harness,
      name: z.string(),
      auth: addProviderRequestSchema.shape.auth,
    }),
  ),
});

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export type ProvidersOptions = {
  /** The user's shell PATH, read per spawn; null keeps the host's. */
  shellPath?: () => Promise<string | null>;
  /** Probe every provider in the background now. */
  probeOnStart?: boolean;
  /** Opens a console the user can see running `command`; resolves when it closes. Tests replace it. */
  openConsole?: (command: string, env: Record<string, string | undefined>) => Promise<void>;
};

/** A PowerShell window of its own (`detached` on win32 is a new console), left open on failure. */
function openConsole(command: string, env: Record<string, string | undefined>): Promise<void> {
  const script = `try { ${command}; if ($LASTEXITCODE) { throw "exited $LASTEXITCODE" } } catch { Write-Host $_; Read-Host 'Press Enter to close' }`;
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  child.unref();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", (error) => {
      log.warn(`login console did not open: ${String(error)}`);
      resolve();
    });
  });
}

export function createProviders(options: ProvidersOptions) {
  const cache = new Map<string, Probed>();
  const inFlight = new Map<string, Promise<Provider>>();

  /** Read once, then kept: this module is the file's only writer. */
  let saved: EndpointRecord[] | null = null;
  const stored = (): EndpointRecord[] => {
    if (saved) return saved;
    const path = productProvidersPath();
    if (!existsSync(path)) return (saved = []);
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) log.warn(`${path} does not parse; no endpoint providers listed`);
    return (saved = parsed.data?.providers ?? []);
  };
  const save = (records: EndpointRecord[]) => {
    writeJson(productProvidersPath(), { providers: records });
    saved = records;
  };
  const records = (): ProviderRecord[] => [
    ...harnessIds.map((harness) => ({
      id: harness,
      harness,
      name: adapters[harness].title,
      auth: { kind: "subscription" as const },
    })),
    ...stored(),
  ];
  const get = (id: string) => records().find((r) => r.id === id) ?? null;

  const view = (record: ProviderRecord): Provider => ({
    id: record.id,
    harness: record.harness,
    name: record.name,
    auth:
      record.auth.kind === "subscription"
        ? { kind: "subscription" }
        : {
            kind: "endpoint",
            baseUrl: record.auth.baseUrl,
            keyLast4: record.auth.apiKey.slice(-4),
          },
    ...(cache.get(record.id) ?? {
      readiness: {
        state: "unknown",
        message: "Not probed yet.",
      },
      models: [],
      traits: [],
      probedAt: null,
    }),
  });

  const userPath = async (): Promise<Record<string, string>> => {
    const path = await options.shellPath?.();
    const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "Path";
    return path ? { [key]: mergePath(path, process.env[key]) } : {};
  };

  /** The child env for a provider on top of the host's: the user's PATH, then the auth source. */
  async function env(
    record: ProviderRecord,
    modelId?: string | null,
  ): Promise<Record<string, string>> {
    const out = await userPath();
    if (record.auth.kind === "endpoint") {
      const provider = cache.has(record.id) ? view(record) : await probe(record);
      if (provider.readiness.state !== "ready")
        throw new Error(
          provider.readiness.state === "refused"
            ? provider.readiness.message
            : "Endpoint readiness is unknown; probe it in Settings.",
        );
      const selected = modelId ?? provider.models[0]?.modelId;
      if (!provider.models.some((model) => model.modelId === selected))
        throw new Error(`The endpoint does not advertise model ${selected}`);
      return { ...out, ...authEnv(record, selected) };
    }
    return { ...out, ...authEnv(record) };
  }

  async function probeRecord(record: ProviderRecord): Promise<Probed> {
    const probedAt = new Date().toISOString();
    const probed = await acpProbe(record, {
      ...process.env,
      ...(await userPath()),
      ...authEnv(record),
    });
    if (probed.readiness.state !== "ready") return { ...probed, probedAt };
    let endpointModels: HarnessModel[] | null = null;
    try {
      if (record.auth.kind === "endpoint")
        endpointModels = await checkEndpoint(
          record.harness,
          record.auth.baseUrl,
          record.auth.apiKey,
          record.auth.modelId,
          record.harness === "codex" ? probed.models : undefined,
        );
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return {
        readiness: { state: "refused", step: error.step, message: error.message },
        models: [],
        traits: [],
        probedAt,
      };
    }
    return { ...probed, ...(endpointModels ? { models: endpointModels } : {}), probedAt };
  }

  function probe(record: ProviderRecord): Promise<Provider> {
    const running = inFlight.get(record.id);
    if (running) return running;
    const next = probeRecord(record)
      .then((probed) => {
        cache.set(record.id, probed);
        log.info(`provider ${record.id} probed: ${probed.readiness.state}`);
        return view(record);
      })
      .finally(() => inFlight.delete(record.id));
    inFlight.set(record.id, next);
    return next;
  }

  const readAccess = (): Access => {
    const path = productAccessPath();
    const parsed = existsSync(path)
      ? accessSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
      : null;
    return parsed?.success ? parsed.data : { guarded: true };
  };

  if (options.probeOnStart ?? true)
    for (const record of records())
      probe(record).catch((error) =>
        log.warn(`provider ${record.id} probe failed: ${String(error)}`),
      );

  const json = (value: unknown, status = 200) => Response.json(value, { status });

  /** Add: the endpoint is checked before anything is written; a refusal is `{step, message}`. */
  async function add(input: AddProviderRequest): Promise<Response> {
    const id = `${input.harness}-${slug(input.name)}`;
    if (id === `${input.harness}-`)
      return json({ step: "endpoint", message: "Name the provider." }, 400);
    if (get(id))
      return json({ error: `A provider ${id} exists; remove it or pick another name.` }, 409);
    const apiKey = input.auth.apiKey.trim();
    let baseUrl: string;
    try {
      if (!apiKey || /\s/.test(apiKey))
        throw new Refusal("API key is empty or contains whitespace");
      baseUrl = normalizeBaseUrl(input.harness, input.auth.baseUrl);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return json({ step: error.step, message: error.message }, 400);
    }
    const record: EndpointRecord = {
      id,
      harness: input.harness,
      name: input.name,
      auth: {
        kind: "endpoint",
        baseUrl,
        apiKey,
        ...(input.auth.modelId ? { modelId: input.auth.modelId } : {}),
      },
    };
    const probed = await probeRecord(record);
    if (probed.readiness.state === "refused" && probed.readiness.step === "endpoint")
      return json({ step: probed.readiness.step, message: probed.readiness.message }, 400);
    save([...stored(), record]);
    cache.set(id, probed);
    log.info(`provider ${id} added (${probed.readiness.state})`);
    return json(view(record));
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const body = async <T>(schema: z.ZodType<T>) => {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json(
          { error: "This route reads a JSON body: send content-type: application/json" },
          415,
        );
      const parsed = schema.safeParse(await request.json().catch(() => null));
      return parsed.success ? parsed.data : json({ error: parsed.error.message }, 400);
    };
    if (url.pathname === "/pe/access") {
      if (method === "GET") return json(readAccess());
      if (method !== "PUT") return json({ error: `No route ${method} ${url.pathname}` }, 404);
      const input = await body(accessSchema);
      if (input instanceof Response) return input;
      writeJson(productAccessPath(), input);
      log.info(`access set: guarded ${input.guarded}`);
      return json(input);
    }
    const [, , , rawId, verb] = url.pathname.split("/"); // "", "pe", "providers", id, verb
    if (!rawId) {
      if (method === "GET") return json(records().map(view));
      if (method !== "POST") return json({ error: `No route ${method} ${url.pathname}` }, 404);
      const input = await body(addProviderRequestSchema);
      return input instanceof Response ? input : add(input);
    }
    const record = get(decodeURIComponent(rawId));
    if (!record) return json({ error: `No provider ${rawId}` }, 404);
    switch (`${method} ${verb ?? ""}`) {
      case "GET ":
        return json(view(record));
      case "DELETE ": {
        if (record.auth.kind === "subscription")
          return json(
            { error: "A subscription provider is the harness's own login; it cannot be removed." },
            409,
          );
        save(stored().filter((r) => r.id !== record.id));
        cache.delete(record.id);
        log.info(`provider ${record.id} removed`);
        return new Response(null, { status: 204 });
      }
      case "POST probe":
        return json(await probe(record));
      case "POST open-login": {
        if (record.auth.kind === "endpoint")
          return json(
            { error: "An endpoint provider has no login; edit its URL or key instead." },
            409,
          );
        const readiness = cache.get(record.id)?.readiness;
        const install = readiness?.state === "refused" && readiness.step === "installed";
        const command = install ? adapters[record.harness].install : adapterLogin(record.harness);
        log.info(`provider ${record.id}: opening a console for \`${command}\``);
        void (options.openConsole ?? openConsole)(command, {
          ...process.env,
          ...(await env(record)),
        })
          .then(() => probe(record))
          .catch((error) => log.warn(`provider ${record.id} re-probe failed: ${String(error)}`));
        return json({ opened: true });
      }
    }
    return json({ error: `No route ${method} ${url.pathname}` }, 404);
  }

  return {
    get,
    env,
    models: (id: string) => cache.get(id)?.models ?? [],
    validateModel: async (record: ProviderRecord, modelId: string) => {
      if (record.auth.kind === "endpoint")
        await checkEndpoint(
          record.harness,
          record.auth.baseUrl,
          record.auth.apiKey,
          modelId,
          record.harness === "codex" ? cache.get(record.id)?.models : undefined,
        );
    },
    access: readAccess,
    /** Every endpoint key, so no thread record keeps one even when a harness echoes it. */
    keys: () =>
      stored()
        .map((r) => r.auth.apiKey)
        .filter(Boolean),
    /** The web handler for `/pe/providers*` and `/pe/access`. */
    fetch: (request: Request) =>
      handle(request).catch((error) => json({ error: String(error?.message ?? error) }, 502)),
  };
}

export type Providers = ReturnType<typeof createProviders>;
