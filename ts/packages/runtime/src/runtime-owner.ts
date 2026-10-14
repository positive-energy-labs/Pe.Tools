import { join } from "node:path";
import { isSea } from "node:sea";
import { hostProcessIdentity, productInstallLayout } from "@pe/host-contracts/contracts";
import { normalizeSourceRoot } from "@pe/host-contracts/pe-service";
import {
  checkoutRootFrom,
  hostServiceName,
  productRoot,
  sourceRootVariable,
  runtimeOwnerRejection,
  installedRuntimeRoot,
} from "@pe/host-contracts/service-identity";

/**
 * Source modules execute for their actual checkout. Spawn plumbing and cwd must agree with it.
 * Installed SEA executables execute only from their canonical manifest location.
 */
export function resolveLaneAndRoot(): {
  lane: "dev" | "installed";
  sourceRoot: string | null;
  serviceName: string;
  installedRoot: string | null;
} {
  const configured = process.env.PE_LANE?.trim().toLowerCase();
  if (configured && configured !== "dev" && configured !== "installed")
    throw Error(`Unknown runtime lane '${configured}'.`);
  const bundled = isSea();
  const moduleRoot = bundled ? null : checkoutRootFrom(import.meta.dirname);
  if (configured === "installed" && moduleRoot)
    throw Error("Source CLI code cannot claim the installed runtime lane.");
  const cwdRoot = checkoutRootFrom(process.cwd());
  const lane: "installed" | "dev" = bundled ? "installed" : "dev";
  if (configured && configured !== lane)
    throw Error(
      `Configured runtime lane '${configured}' does not match the executable lane '${lane}'.`,
    );
  if (!bundled && !moduleRoot)
    throw Error("Source CLI code requires its actual Pe.Tools checkout.");
  const sourceRoot = lane === "dev" ? moduleRoot : null;
  if (lane === "installed" && process.env[sourceRootVariable]?.trim())
    throw Error("An installed CLI cannot claim a checkout source root.");
  // This shared context runs in both packaged Host and Pea. Infer only a canonical Host entry;
  // all remaining installed callers must pass the canonical Pea validator (copies still refuse).
  const installedApp =
    normalizeSourceRoot(process.execPath) ===
    normalizeSourceRoot(join(productRoot(), productInstallLayout["VersionedApp:host"]))
      ? "host"
      : "pea";
  const installedRoot = lane === "installed" ? installedRuntimeRoot(installedApp) : null;
  const baseServiceName = hostServiceName(lane, sourceRoot);
  const serviceName =
    process.env[hostProcessIdentity.serviceNameVariable]?.trim() || baseServiceName;
  if (
    serviceName !== baseServiceName &&
    !(lane === "dev" && serviceName === `${baseServiceName}-no-revit`)
  )
    throw Error(`Configured host service '${serviceName}' does not belong to this runtime.`);
  const owner = { lane, sourceRoot, installedRoot, serviceName };
  if (lane === "dev") {
    for (const candidate of [process.env[sourceRootVariable]?.trim(), cwdRoot]) {
      if (!candidate) continue;
      const rejection = runtimeOwnerRejection(owner, { ...owner, sourceRoot: candidate });
      if (rejection) throw Error(rejection);
    }
  }
  return owner;
}
