import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/**
 * PostHog usage analytics for the internal beta: prompts, tool calls, host ops,
 * boots, and errors from coworkers' machines land in one PostHog project.
 *
 * Configured via `Documents\Pe.Tools\settings\Global\settings.json`:
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
  const config = analyticsConfig();
  if (!config) return;
  const body = JSON.stringify({
    api_key: config.apiKey,
    event,
    distinct_id: distinctId(),
    timestamp: new Date().toISOString(),
    properties: { ...baseProperties(), ...properties },
  });
  fetch(`${config.host}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).catch(() => undefined);
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
  try {
    const raw = readFileSync(globalSettingsPath(), "utf8");
    const parsed = JSON.parse(raw) as { posthog?: { apiKey?: string; host?: string } };
    const apiKey = parsed.posthog?.apiKey?.trim();
    if (!apiKey) return null;
    return {
      apiKey,
      host: (parsed.posthog?.host ?? "https://us.i.posthog.com").replace(/\/$/, ""),
    };
  } catch {
    return null;
  }
}

// Mirrors apps/host/src/product-paths.ts (Documents may be OneDrive-redirected on
// coworkers' machines, so the known-folder lookup matters). Kept local: runtime
// cannot import host code.
function globalSettingsPath(): string {
  return join(userDocumentsPath(), "Pe.Tools", "settings", "Global", "settings.json");
}

function userDocumentsPath(): string {
  const override = process.env.PE_TOOLS_DOCUMENTS_ROOT?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "[Environment]::GetFolderPath('MyDocuments')",
        ],
        { encoding: "utf8", timeout: 1_000, windowsHide: true },
      ).trim();
      if (output) return output;
    } catch {
      /* fall through */
    }
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return join(home, "Documents");
}
