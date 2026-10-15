// Product adapter over the SDK-owned pe-revit-cli.ts (vendored verbatim — do not fork it again).
// This is the only place that binds product identity and host ownership to the generic launch chain.

import { productIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership, type HostOwnership } from "./host-ownership.ts";
import { peRevitLaunch, type PeRevitLaunch } from "@pe/host-contracts/pe-revit-cli";

export { validatePeRevitEnvelope, parsePeRevitEnvelope } from "@pe/host-contracts/pe-revit-cli";
export type { PeRevitLaunch } from "@pe/host-contracts/pe-revit-cli";

export function peRevitLauncher(
  ownership: Pick<HostOwnership, "lane" | "sourceRoot"> = hostOwnership,
): PeRevitLaunch {
  return peRevitLaunch({
    lane: ownership.lane,
    // The dotnet tool manifest + product.payloads.json live at the checkout root.
    devWorkingDirectory: ownership.sourceRoot,
    vendorName: productIdentity.vendorName,
    productName: productIdentity.productName,
  });
}

/** An apphost that cannot start (no .NET runtime) explains itself on stderr only; keep the tail with the error. */
export function withStderr(error: unknown, stderr: string): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  const tail = stderr.trim();
  return tail ? new Error(`${failure.message}; stderr: ${tail}`) : failure;
}
