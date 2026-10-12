import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
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

function distinctId(): string {
  const user = process.env.USERNAME ?? process.env.USER ?? "unknown";
  return `${hostname()}\\${user}`;
}

function baseProperties(): Record<string, unknown> {
  return { machine: hostname(), os: process.platform };
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
function installedManifestPath(): string {
  const localAppData =
    process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Local");
  return join(localAppData, "Positive Energy", "Pe.Tools", "product.payloads.json");
}

// The one Documents resolver lives in @pe/host-contracts/product-paths; Documents may be
// OneDrive-redirected, and a second copy here is a second answer.
function preferencesPath(): string {
  return join(userDocumentsPath(), "Pe.Tools", "preferences.json");
}
