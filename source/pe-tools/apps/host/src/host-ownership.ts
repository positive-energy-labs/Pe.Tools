import { homedir } from "node:os";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { hostProcessIdentity, productIdentity } from "@pe/host-contracts/contracts";

export type HostLane = "dev" | "installed";

export type HostOwnership = {
  readonly executablePath: string;
  readonly lane: HostLane;
  readonly processId: number;
  readonly sourceRoot: string | null;
};

const HOST_BASE_URL =
  process.env[hostProcessIdentity.hostBaseUrlVariable] ?? hostProcessIdentity.defaultHostBaseUrl;

// The preferred/fixed listen port. Discovery is file-based (the SDK claim records the ACTUAL bound
// port in state/service/host.json); this is only the bind hint and the dev-web proxy target.
export const HOST_PORT = Number(new URL(HOST_BASE_URL).port || "5180");
export const hostOwnership = resolveHostOwnership();

/**
 * Product root under `%LOCALAPPDATA%\<vendor>\<product>` — the A10 service-file `appBase`
 * (`state/service/host.json` lives beneath it) and the install-receipt root. Resolved lazily so
 * tests can redirect it via `LOCALAPPDATA`.
 */
export function productRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
  );
}

function resolveHostOwnership(): HostOwnership {
  return {
    executablePath: process.execPath,
    lane: resolveHostLane(),
    processId: process.pid,
    sourceRoot: resolveSourceRoot(),
  };
}

function resolveHostLane(): HostLane {
  // PE_LANE is the SINGLE authoritative lane signal: InstalledService sets it on every installed
  // spawn, TsHostLauncher sets it for the Revit-dev spawn, and ensure-source-lane.ts sets it for
  // bare source runs. No PE_TOOLS_HOST_LANE, no path/argv heuristic, no silent default — an unknown
  // lane is a launch-configuration bug, so fail fast loudly rather than guess (IPC-SEAM-SPEC D7).
  const lane = process.env.PE_LANE?.trim().toLowerCase();
  if (lane === "dev" || lane === "installed") return lane;
  throw new Error(
    `PE_LANE must be 'dev' or 'installed' to resolve host ownership (got ${JSON.stringify(process.env.PE_LANE)}); ` +
      "the host lane is the SDK-owned PE_LANE signal and this host refuses to guess it.",
  );
}

function resolveSourceRoot(): string | null {
  if (hostOwnershipEnvironmentSource()) return hostOwnershipEnvironmentSource();
  const modulePath = currentModulePath();
  if (!modulePath) return null;
  const marker = `${normalize("apps/host/src").toLowerCase()}\\`;
  const normalized = normalize(modulePath);
  const index = normalized.toLowerCase().indexOf(marker);
  return index >= 0 ? normalized.slice(0, index - 1) : null;
}

function hostOwnershipEnvironmentSource(): string | null {
  const value = process.env.PE_TOOLS_HOST_SOURCE_DIR?.trim();
  return value || null;
}

function currentModulePath(): string | null {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return null;
  }
}
