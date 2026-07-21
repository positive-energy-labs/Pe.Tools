import { normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { hostServiceName } from "@pe/host-contracts/service-identity";

export { productRoot } from "@pe/host-contracts/service-identity";

export type HostLane = "dev" | "installed";

export type HostOwnership = {
  readonly executablePath: string;
  readonly lane: HostLane;
  readonly processId: number;
  readonly serviceName: string;
  readonly sourceRoot: string | null;
};

export const hostOwnership = resolveHostOwnership();

function resolveHostOwnership(): HostOwnership {
  const lane = resolveHostLane();
  const sourceRoot = lane === "dev" ? resolveSourceRoot() : null;
  const serviceName = hostServiceName(lane, sourceRoot);
  const configuredServiceName = process.env[hostProcessIdentity.serviceNameVariable]?.trim();
  if (configuredServiceName && configuredServiceName !== serviceName)
    throw new Error(
      `${hostProcessIdentity.serviceNameVariable}=${JSON.stringify(configuredServiceName)} does not match ` +
        `${lane} runtime identity ${JSON.stringify(serviceName)}.`,
    );
  return {
    executablePath: process.execPath,
    lane,
    processId: process.pid,
    serviceName,
    sourceRoot,
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
  const modulePath = normalize(fileURLToPath(import.meta.url));
  const marker = `${normalize("apps/host/src").toLowerCase()}\\`;
  const index = modulePath.toLowerCase().indexOf(marker);
  return index >= 0 ? modulePath.slice(0, index - 1) : null;
}

function hostOwnershipEnvironmentSource(): string | null {
  const value = process.env.PE_TOOLS_HOST_SOURCE_DIR?.trim();
  return value || null;
}
