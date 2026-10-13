import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { productHomePath } from "@pe/host-contracts/product-paths";
import { productRoot } from "@pe/host-contracts/service-identity";

export interface AnalyticsConfig {
  apiKey: string;
  host: string;
}
export const ANALYTICS_PAYLOAD_BUDGET = 256 * 1024;

/** Select the lane before reading keys. A dev host never uses an installed ingest key. */
export function analyticsConfig(lane: "dev" | "installed"): AnalyticsConfig | null {
  const path =
    lane === "dev"
      ? join(productHomePath(), "preferences.json")
      : join(productRoot(), "product.payloads.json");
  const file = readJson(path) as
    | {
        posthog?: AnalyticsConfig;
        telemetry?: { posthog?: AnalyticsConfig };
      }
    | undefined;
  const config = lane === "dev" ? file?.posthog : file?.telemetry?.posthog;
  if (!config || typeof config.apiKey !== "string" || !config.apiKey.trim()) return null;
  const host = typeof config.host === "string" ? config.host : "https://us.i.posthog.com";
  try {
    if (new URL(host).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { apiKey: config.apiKey.trim(), host: host.replace(/\/$/, "") };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Exclusive creation preserves the winner's opaque UUID. Invalid identity disables export. */
export function readOrCreateInstallId(): string | null {
  try {
    const path = join(productRoot(), "state", "install.json");
    const read = () => (readJson(path) as { installId?: unknown } | undefined)?.installId;
    const existing = read();
    if (validId(existing)) return existing;
    mkdirSync(dirname(path), { recursive: true });
    const id = randomUUID();
    try {
      writeFileSync(path, JSON.stringify({ installId: id }), { flag: "wx" });
      return id;
    } catch {
      const winner = read();
      return validId(winner) ? winner : null;
    }
  } catch {
    return null;
  }
}

/** Raw fault evidence is local, including failures before the host's module graph can load. */
export function writeFatalEvidence(
  code: "process.uncaught" | "process.unhandled-rejection",
  error: unknown,
) {
  try {
    const path = join(productRoot(), "logs");
    mkdirSync(path, { recursive: true });
    appendFileSync(
      join(path, "host-fatal.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), code, error: error instanceof Error ? error.stack : String(error) })}\n`,
    );
  } catch {
    console.error("Host fatal local record failed", error);
  }
}
