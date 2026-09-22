// Product adapter over the SDK-owned pe-revit-cli.ts (vendored verbatim — do not fork it again).
// This is the only place that binds product identity and host ownership to the generic launch chain.

import { productIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership, type HostOwnership } from "./host-ownership.ts";
import {
  installRoot as sdkInstallRoot,
  peRevitLaunch,
  type PeRevitLaunch,
} from "@pe/host-contracts/pe-revit-cli";

export { validatePeRevitEnvelope, parsePeRevitEnvelope } from "@pe/host-contracts/pe-revit-cli";
export type { PeRevitLaunch, PeRevitEnvelope } from "@pe/host-contracts/pe-revit-cli";

export function peRevitLauncher(
  ownership: Pick<HostOwnership, "lane" | "sourceRoot"> = hostOwnership,
  override: string | undefined = process.env.PE_REVIT_CMD,
  fileExists?: (path: string) => boolean,
): PeRevitLaunch {
  return peRevitLaunch(
    {
      lane: ownership.lane,
      // The dotnet tool manifest + product.payloads.json live at the checkout root.
      devWorkingDirectory: ownership.sourceRoot,
      vendorName: productIdentity.vendorName,
      productName: productIdentity.productName,
    },
    override,
    process.env.LOCALAPPDATA,
    ...(fileExists ? [fileExists] : []),
  );
}

/** Product root under `%LOCALAPPDATA%\<vendor>\<product>` (bin, shims, logs). */
export function installRoot(): string {
  return sdkInstallRoot(productIdentity.vendorName, productIdentity.productName);
}
