import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  hostServiceName,
  sourceRootVariable,
  type HostLane,
} from "@pe/host-contracts/service-identity";
import type { PeaRuntimeCapabilities } from "@pe/runtime/pea";

export { productRoot } from "@pe/host-contracts/service-identity";

export type { HostLane } from "@pe/host-contracts/service-identity";

export type HostOwnership = {
  readonly executablePath: string;
  readonly lane: HostLane;
  readonly processId: number;
  readonly serviceName: string;
  readonly sourceRoot: string | null;
};

export const NO_REVIT_ARGUMENT = "--no-revit";
export const hostCapabilities = resolveHostCapabilities();
export const hostOwnership = resolveHostOwnership();

export function resolveHostCapabilities(
  argv: readonly string[] = process.argv,
): PeaRuntimeCapabilities {
  return { revit: !argv.includes(NO_REVIT_ARGUMENT) };
}

export function serviceNameForCapabilities(
  serviceName: string,
  capabilities: PeaRuntimeCapabilities,
): string {
  return capabilities.revit ? serviceName : `${serviceName}-no-revit`;
}

function resolveHostOwnership(): HostOwnership {
  const lane = resolveHostLane();
  if (!hostCapabilities.revit && lane !== "dev")
    throw new Error(`${NO_REVIT_ARGUMENT} is available only for the dev host.`);
  const sourceRoot = lane === "dev" ? resolveSourceRoot() : null;
  const serviceName = serviceNameForCapabilities(
    hostServiceName(lane, sourceRoot),
    hostCapabilities,
  );
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
  // PE_LANE is the SINGLE authoritative lane signal: TsHostLauncher sets it on every Revit-driven
  // spawn (installed and dev alike), and ensure-source-lane.ts sets it for
  // bare source runs. No PE_TOOLS_HOST_LANE, no path/argv heuristic, no silent default — an unknown
  // lane is a launch-configuration bug, so fail fast loudly rather than guess (IPC-SEAM-SPEC D7).
  const lane = process.env.PE_LANE?.trim().toLowerCase();
  if (lane === "dev" || lane === "installed") return lane;
  throw new Error(
    `PE_LANE must be 'dev' or 'installed' to resolve host ownership (got ${JSON.stringify(process.env.PE_LANE)}); ` +
      "the host lane is the SDK-owned PE_LANE signal and this host refuses to guess it.",
  );
}

/**
 * The dev host's identity input: the checkout it serves. Spawn plumbing wins (a supervisor telling
 * the child what it just spawned); otherwise the checkout this module lives in. Host, MCP clients,
 * pea, and `TsHostLauncher` all hash the checkout root, so they agree by construction.
 */
function resolveSourceRoot(): string | null {
  return process.env[sourceRootVariable]?.trim() || checkoutRootFrom(import.meta.dirname);
}
