import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { userDocumentsPath } from "@pe/host-contracts/product-paths";

/**
 * PostHog usage analytics for the internal beta: prompts, tool calls, host ops,
 * boots, and errors from coworkers' machines land in one PostHog project.
 *
 * The installed product manifest carries the key; a checkout reads `Documents\Pe.Tools\preferences.json`:
 *   { "posthog": { "apiKey": "phc_...", "host": "https://us.i.posthog.com" } }
 * No key → every call is a no-op. The key is a public write-only ingest key,
 * so shipping it in settings/binaries is by design (no auth).
 *
 * ponytail: hand-rolled capture instead of posthog-node — one fire-and-forget
 * POST per event at internal-beta volume; adopt posthog-node if we ever need
 * batching, feature flags, or delivery guarantees.
 */

export interface AnalyticsConfig {
  apiKey: string;
  host: string;
}

/** Per-side payload budget. Truncation is itself a signal (`*_truncated: true`). */
export const ANALYTICS_PAYLOAD_BUDGET = 256 * 1024;

let cachedConfig: AnalyticsConfig | null | undefined;

export function analyticsConfig(): AnalyticsConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  cachedConfig = loadConfig();
  return cachedConfig;
}

export function analyticsEnabled(): boolean {
  return analyticsConfig() !== null;
}

/** Fire-and-forget event capture. Never throws, never blocks the caller. */
export function capture(event: string, properties: Record<string, unknown>): void {
  if (analyticsEnabled()) captureNow(event, properties).catch(() => undefined);
}

/** Awaited capture for user-authored events: throws when unconfigured or PostHog refuses. */
export async function captureNow(
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const config = analyticsConfig();
  if (!config) throw new Error("PostHog is not configured on this machine");
  const response = await fetch(`${config.host}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: config.apiKey,
      event,
      distinct_id: distinctId(),
      timestamp: new Date().toISOString(),
      properties: { ...baseProperties(), ...properties },
    }),
  });
  if (!response.ok) throw new Error(`PostHog refused the event (${response.status})`);
}

/** PostHog error-tracking event ($exception) from a caught error. */
export function captureException(error: unknown, properties: Record<string, unknown> = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));
  capture("$exception", {
    ...properties,
    $exception_list: [
      {
        type: err.name,
        value: err.message,
        mechanism: { handled: true, synthetic: false },
        stacktrace: { type: "raw", frames: [] },
      },
    ],
    $exception_stack_trace_raw: err.stack,
  });
}

/**
 * Serialize an arbitrary payload for event properties under the size budget.
 * Returns `{ json, truncated, bytes }` so clipped payloads stay visible as data.
 */
export function boundedPayload(value: unknown): {
  json: string;
  truncated: boolean;
  bytes: number;
} {
  let json: string;
  try {
    json = typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
  } catch {
    json = String(value);
  }
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes <= ANALYTICS_PAYLOAD_BUDGET) return { json, truncated: false, bytes };
  return { json: json.slice(0, ANALYTICS_PAYLOAD_BUDGET), truncated: true, bytes };
}

// Upper-cased to match .NET's Environment.MachineName, so the host and the add-in are one person.
function machineName(): string {
  return hostname().toUpperCase();
}

function distinctId(): string {
  const user = process.env.USERNAME ?? process.env.USER ?? "unknown";
  return `${machineName()}\\${user}`;
}

/**
 * Every event names what sent it. Without `version` and `lane` a field incident is a hunt through
 * `app_boot` rows (DELL_PE, 2026-10-12: a 0.7.0 host under a 0.7.17 add-in, found by hand).
 * Only the host imports this module, so `component` is a constant here.
 */
function baseProperties(): Record<string, unknown> {
  const lane = process.env.PE_LANE ?? "dev";
  return {
    machine: machineName(),
    os: process.platform,
    component: "host",
    lane,
    version: lane === "installed" ? installedVersion() : "dev",
    install_id: installId(),
  };
}

let cachedVersion: string | undefined;

function installedVersion(): string {
  cachedVersion ??= (() => {
    const version = (readJson(installedManifestPath()) as { version?: unknown } | undefined)
      ?.version;
    return typeof version === "string" && version ? version : "unknown";
  })();
  return cachedVersion;
}

function loadConfig(): AnalyticsConfig | null {
  // The installed product manifest is AUTHORITATIVE: the key rides the release
  // (product.payloads.json, copied into the installed root by the SDK apply kernel), so
  // installed machines need zero seeding. preferences.json stays as the
  // dev/override fallback for checkouts without an installed product.
  type PostHogShape = { apiKey?: string; host?: string };
  const manifest = readJson(installedManifestPath()) as
    | { telemetry?: { posthog?: PostHogShape } }
    | undefined;
  const preferences = readJson(preferencesPath()) as { posthog?: PostHogShape } | undefined;
  return fromShape(manifest?.telemetry?.posthog) ?? fromShape(preferences?.posthog);
}

function fromShape(
  posthog: { apiKey?: string; host?: string } | undefined,
): AnalyticsConfig | null {
  const apiKey = posthog?.apiKey?.trim();
  if (!apiKey) return null;
  return { apiKey, host: (posthog?.host ?? "https://us.i.posthog.com").replace(/\/$/, "") };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// Mirrors the SDK's installed layout (%LOCALAPPDATA%\<vendor>\<product>\product.payloads.json).
// Kept local for the same reason as preferencesPath: runtime cannot import host code.
function productRoot(): string {
  const localAppData =
    process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Local");
  return join(localAppData, "Positive Energy", "Pe.Tools");
}

function installedManifestPath(): string {
  return join(productRoot(), "product.payloads.json");
}

let cachedInstallId: string | undefined;

/** One stable id per machine install, shared with the add-in (PostHogAnalytics.cs). Cached per process. */
function installId(): string {
  cachedInstallId ??= readOrCreateInstallId();
  return cachedInstallId;
}

/**
 * `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\install.json` = `{"installId":"<uuid v4>"}`.
 * Exclusive create; a lost race re-reads the winner's file. Never throws ("unknown" on failure).
 */
export function readOrCreateInstallId(): string {
  try {
    const path = join(productRoot(), "state", "install.json");
    const read = () => (readJson(path) as { installId?: unknown } | undefined)?.installId;
    const existing = read();
    if (typeof existing === "string" && existing) return existing;
    mkdirSync(dirname(path), { recursive: true });
    const id = randomUUID();
    try {
      writeFileSync(path, JSON.stringify({ installId: id }), { flag: "wx" });
      return id;
    } catch {
      const raced = read();
      return typeof raced === "string" && raced ? raced : "unknown";
    }
  } catch {
    return "unknown";
  }
}

// The one Documents resolver lives in @pe/host-contracts/product-paths; Documents may be
// OneDrive-redirected, and a second copy here is a second answer.
function preferencesPath(): string {
  return join(userDocumentsPath(), "Pe.Tools", "preferences.json");
}
