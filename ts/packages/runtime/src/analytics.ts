import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { resolveKey } from "@pe/host-contracts/shared-keys";
import { readStored, writeAtomic } from "@pe/host-contracts/store";
import { runtimeRoot } from "./runtime-owner.ts";
import { productPathNames } from "@pe/host-contracts/contracts";

export interface AnalyticsConfig {
  apiKey: string;
  host: string;
}
export const ANALYTICS_PAYLOAD_BUDGET = 256 * 1024;

/**
 * Select the lane before reading keys. A dev host never uses an installed ingest key: its key is
 * the firm keys.json `posthog.api-key`, and with none (or no firm home) export is off. The
 * installed lane's key and host ship in its manifest and are never a firm setting. Nothing here
 * reads a person's own file: no home holds an analytics setting.
 */
export function analyticsConfig(lane: "dev" | "installed"): AnalyticsConfig | null {
  const config =
    lane === "dev"
      ? undefined
      : (readJson(join(runtimeRoot(), "product.payloads.json")) as
          | { telemetry?: { posthog?: AnalyticsConfig } }
          | undefined)?.telemetry?.posthog;
  const key =
    lane === "dev"
      ? resolveKey(null, "posthog.api-key")
      : typeof config?.apiKey === "string" && config.apiKey.trim()
        ? { value: config.apiKey.trim() }
        : { refused: "no-key" as const };
  if ("refused" in key) return null;
  const host = typeof config?.host === "string" ? config.host : "https://us.i.posthog.com";
  try {
    if (new URL(host).protocol !== "https:") return null;
  } catch (error) { console.warn("ts/packages/runtime/src/analytics.ts: fallback after failure", error);
    return null;
  }
  return { apiKey: key.value, host: host.replace(/\/$/, "") };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) { console.warn("ts/packages/runtime/src/analytics.ts: fallback after failure", error);
    return undefined;
  }
}
const installFile = z.object({ installId: z.uuid() });

/**
 * This install's opaque id, from `state\install.json`. The file is machine state, so its class is
 * `discard` (ADR 0039): one that does not decode is deleted with one notice and a new id is minted.
 * It never yields a null id, so it cannot stop the host. Null only when the disk refuses the write.
 * ponytail: two processes that mint in the same instant each write, and the later rename wins;
 * both then read the file back, so they agree unless the reads straddle the second rename. Publish
 * by exclusive hard link if two hosts ever start on one fresh root together.
 */
export function readOrCreateInstallId(): string | null {
  try {
    const state = join(runtimeRoot(), "state");
    const path = join(state, "install.json");
    const read = () =>
      readStored(path, installFile, {
        class: "discard",
        place: "Install identity",
        notices: join(state, productPathNames.storedNoticesFileName),
      });
    const existing = read();
    if (existing.kind === "ok") return existing.value.installId;
    const id = randomUUID();
    writeAtomic(path, JSON.stringify({ installId: id }));
    const written = read();
    return written.kind === "ok" ? written.value.installId : id;
  } catch (error) { console.warn("ts/packages/runtime/src/analytics.ts: fallback after failure", error);
    return null;
  }
}

/** Raw fault evidence is local, including failures before the host's module graph can load. */
export function writeFatalEvidence(
  code: "process.uncaught" | "process.unhandled-rejection",
  error: unknown,
) {
  try {
    const path = join(runtimeRoot(), "logs");
    mkdirSync(path, { recursive: true });
    appendFileSync(
      join(path, "host-fatal.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), code, error: error instanceof Error ? error.stack : String(error) })}\n`,
    );
  } catch {
    console.error("Host fatal local record failed", error);
  }
}
