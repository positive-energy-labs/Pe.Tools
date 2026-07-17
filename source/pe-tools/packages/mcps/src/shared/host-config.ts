import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostProcessIdentity,
  productIdentity,
  scriptingWorkspaceIdentity,
} from "@pe/host-contracts/contracts";
import { hostServiceName } from "@pe/host-contracts/service-identity";
import { firstNonBlank } from "./cli-values.ts";

function productRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
  );
}

function sourceRootFromModule(): string | null {
  const modulePath = normalize(fileURLToPath(import.meta.url));
  const marker = `${normalize("packages/mcps/src").toLowerCase()}\\`;
  const index = modulePath.toLowerCase().indexOf(marker);
  return index >= 0 ? modulePath.slice(0, index - 1) : null;
}

function readHostServiceBaseUrl(name: string): string | null {
  const path = join(productRoot(), "state", "service", `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { port?: unknown };
    return typeof value.port === "number" && value.port > 0
      ? `http://127.0.0.1:${value.port}`
      : null;
  } catch {
    return null;
  }
}

export function resolveHostBaseUrl(value?: string): string {
  const explicit = firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]);
  if (explicit) return explicit;

  const configuredLane = process.env.PE_LANE?.trim().toLowerCase();
  const inferredSourceRoot = sourceRootFromModule();
  const lane =
    configuredLane === "dev" || (configuredLane !== "installed" && inferredSourceRoot)
      ? "dev"
      : "installed";
  const sourceRoot =
    lane === "dev" ? (process.env.PE_TOOLS_HOST_SOURCE_DIR?.trim() ?? inferredSourceRoot) : null;
  const discovered = readHostServiceBaseUrl(hostServiceName(lane, sourceRoot));
  return discovered ?? hostProcessIdentity.defaultHostBaseUrl;
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? scriptingWorkspaceIdentity.defaultWorkspaceKey;
}
