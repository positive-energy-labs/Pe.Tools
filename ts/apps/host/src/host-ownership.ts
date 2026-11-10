import { join } from "node:path";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  hostServiceName,
  sourceRootVariable,
  runtimeOwnerRejection,
  installedRuntimeRoot,
  productRoot,
  type HostLane,
} from "@pe/host-contracts/service-identity";
import type { PeaRuntimeCapabilities } from "@pe/runtime";

export type { HostLane } from "@pe/host-contracts/service-identity";

export type HostOwnership = {
  readonly executablePath: string;
  readonly lane: HostLane;
  readonly processId: number;
  readonly serviceName: string;
  readonly sourceRoot: string | null;
  readonly installedRoot: string | null;
  /** The one state root, computed once from the told owner; host code never re-derives it. */
  readonly rootPath: string;
};

const NO_REVIT_ARGUMENT = "--no-revit";
export const hostCapabilities = resolveHostCapabilities();
export const hostOwnership = resolveHostOwnership();
/** The one directory for this host runtime's journal, log and exporter files. */
export const hostStateDir = () => join(hostOwnership.rootPath, "state", "host", hostOwnership.serviceName);

function resolveHostCapabilities(argv: readonly string[] = process.argv): PeaRuntimeCapabilities {
  return { revit: !argv.includes(NO_REVIT_ARGUMENT) };
}

function serviceNameForCapabilities(
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
  if (lane === "installed" && process.env[sourceRootVariable]?.trim())
    throw Error("An installed host cannot claim a checkout source root.");
  const installedRoot = lane === "installed" ? installedRuntimeRoot("host") : null;
  const rootPath = productRoot({ lane, sourceRoot, installedRoot });
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
    installedRoot,
    rootPath,
  };
}

function resolveHostLane(): HostLane {
  // PE_LANE is the SINGLE authoritative lane signal: the SDK supervisor sets it on every Revit-driven
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
 * The dev host's identity input is the checkout containing this module. Spawn plumbing must agree.
 */
function resolveSourceRoot(): string | null {
  const sourceRoot = checkoutRootFrom(import.meta.dirname);
  const configured = process.env[sourceRootVariable]?.trim();
  if (!sourceRoot) throw Error("A dev host must execute from a Pe.Tools checkout.");
  if (configured) {
    const rejection = runtimeOwnerRejection(
      { lane: "dev", sourceRoot, serviceName: hostServiceName("dev", sourceRoot) },
      { lane: "dev", sourceRoot: configured, serviceName: hostServiceName("dev", sourceRoot) },
    );
    if (rejection) throw Error(rejection);
  }
  return sourceRoot;
}
